"""
Gemini AI Provider Implementation

Concrete implementation of AIProvider using Google's Gemini API.
"""
import os
import json
import time
from typing import Dict, Any, Optional, List
from .redis_cache import RedisCache

try:
    import google.generativeai as genai
    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False

from ..ai_provider import AIProvider, AIProviderResult


class GeminiProvider(AIProvider):
    """Google Gemini AI provider implementation"""
    
    def __init__(self, api_key: Optional[str] = None):
        """
        Initialize Gemini provider
        
        Args:
            api_key: Gemini API key (if None, reads from GEMINI_API_KEY env var)
        """
        self.api_key = api_key or os.getenv("GEMINI_API_KEY")
        # Use gemini-2.0-flash for free tier (fast and efficient)
        # Alternative: gemini-2.5-flash (newer, may have better quality)
        # Or: gemini-2.0-flash-lite (even faster, lighter)
        self.model_name = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
        self._configured = False
        self.cache = RedisCache()
        
        if self.api_key and GEMINI_AVAILABLE:
            try:
                genai.configure(api_key=self.api_key)
                self._configured = True
            except Exception as e:
                print(f"⚠️  Warning: Failed to configure Gemini: {e}")
    
    def is_configured(self) -> bool:
        """Check if Gemini is properly configured"""
        return self._configured and GEMINI_AVAILABLE and self.api_key is not None
    
    def get_provider_name(self) -> str:
        """Get provider name"""
        return "gemini"
    
    def process_prompt(self, user_prompt: str, context_params: Optional[Dict[str, Any]] = None, client_type: str = "premiere") -> Dict[str, Any]:
        """
        Process user prompt using Gemini Function Calling API.
        
        This uses structured function declarations instead of a 600+ line prompt,
        reducing token costs by ~98% and improving reliability.
        
        client_type: "premiere" for plugin schemas, "desktop" for standalone editor schemas
        """
        if not self.is_configured():
            return AIProviderResult.failure(
                message="Gemini API not configured. Please set GEMINI_API_KEY.",
                error="API_KEY_MISSING"
            ).to_dict()
        
        # Check cache
        cached = self.cache.get(user_prompt, context_params)
        if cached:
            print("[Gemini] Cache hit")
            return cached
        try:
            # Select schemas based on client type
            if client_type == "desktop":
                from .function_schemas_desktop import get_desktop_function_declarations, DESKTOP_FUNCTION_CALLING_SYSTEM_PROMPT
                declarations = get_desktop_function_declarations()
                system_prompt = DESKTOP_FUNCTION_CALLING_SYSTEM_PROMPT
            else:
                from .function_schemas import get_function_declarations, FUNCTION_CALLING_SYSTEM_PROMPT
                declarations = get_function_declarations()
                system_prompt = FUNCTION_CALLING_SYSTEM_PROMPT
            
            # Get Gemini model
            model_name = self.model_name.replace("models/", "") if self.model_name.startswith("models/") else self.model_name
            
            # Build the tools (function declarations)
            tools = [{"function_declarations": declarations}]
            
            # Create model with system instruction
            model = genai.GenerativeModel(
                model_name,
                system_instruction=system_prompt
            )
            
            # Format context if available
            prompt = user_prompt
            if context_params:
                context_str = f"\nContext - current effect parameters: {json.dumps(context_params)}"
                prompt = f"{user_prompt}{context_str}"
            
            print(f"[Function Calling] Making request to Gemini API (model: {model_name})")
            print(f"[Function Calling] Prompt: {prompt[:100]}...")
            
            # Generate response with function calling
            max_retries = 3
            retry_delay = 1
            response = None
            last_error = None
            
            for attempt in range(max_retries):
                try:
                    response = model.generate_content(
                        prompt,
                        tools=tools,
                        tool_config={"function_calling_config": {"mode": "AUTO"}}
                    )
                    print(f"[Function Calling] ✅ Success on attempt {attempt + 1}")
                    break
                except Exception as e:
                    last_error = e
                    error_str = str(e).lower()
                    error_full = str(e)
                    
                    print(f"[Function Calling] ❌ Error on attempt {attempt + 1}: {error_full}")
                    
                    is_rate_limit = (
                        "429" in error_str or 
                        ("quota" in error_str and "exceeded" in error_str) or
                        "rate limit" in error_str or
                        "resource exhausted" in error_str or
                        "too many requests" in error_str
                    )
                    
                    if is_rate_limit and attempt < max_retries - 1:
                        wait_time = retry_delay * (2 ** attempt)
                        print(f"[Retry] Rate limit hit. Waiting {wait_time}s...")
                        time.sleep(wait_time)
                    else:
                        raise
            
            if response is None:
                error_msg = str(last_error) if last_error else "Unknown error"
                return AIProviderResult.failure(
                    message=f"Gemini API error: {error_msg}",
                    error="AI_ERROR"
                ).to_dict()
            
            # Extract function call(s) from response
            candidate = response.candidates[0]
            parts = candidate.content.parts
            
            # Collect all function calls
            function_calls = []
            text_response = None
            
            for part in parts:
                if hasattr(part, 'function_call') and part.function_call:
                    fc = part.function_call
                    function_calls.append({
                        "name": fc.name,
                        "args": dict(fc.args) if fc.args else {}
                    })
                elif hasattr(part, 'text') and part.text:
                    text_response = part.text
            
            print(f"[Function Calling] Got {len(function_calls)} function call(s)")
            
            # No function calls - might be text response
            if not function_calls:
                if text_response:
                    print(f"[Function Calling] Text response (no function): {text_response[:100]}...")
                    return AIProviderResult.failure(
                        message=text_response,
                        error="NEEDS_SPECIFICATION"
                    ).to_dict()
                else:
                    return AIProviderResult.failure(
                        message="Could not understand the request. Please try rephrasing.",
                        error="NO_FUNCTION_CALL"
                    ).to_dict()
            
            # Handle askClarification specially - this is a "failure" that needs user input
            if len(function_calls) == 1 and function_calls[0]["name"] == "askClarification":
                args = function_calls[0]["args"]
                message = args.get("message", "Could you clarify what you'd like to do?")
                suggestions = args.get("suggestions", [])
                if suggestions:
                    message += "\n\nOptions: " + ", ".join(suggestions)
                return AIProviderResult.failure(
                    message=message,
                    error="NEEDS_SPECIFICATION"
                ).to_dict()
            
            # Single function call
            if len(function_calls) == 1:
                fc = function_calls[0]
                action = fc["name"]
                parameters = fc["args"]
                
                # Apply defaults for optional parameters
                parameters = self._apply_defaults(action, parameters)
                
                print(f"[Function Calling] Action: {action}, Parameters: {parameters}")
                
                result = AIProviderResult.success(
                    action=action,
                    parameters=parameters,
                    message=f"Executing {action}",
                    confidence=1.0
                ).to_dict()

                self.cache.set(user_prompt, result, context_params)
                return result
            # Multiple function calls
            actions = []
            for fc in function_calls:
                if fc["name"] == "askClarification":
                    continue  # Skip clarification in multi-action
                action = fc["name"]
                parameters = self._apply_defaults(action, fc["args"])
                actions.append({
                    "action": action,
                    "parameters": parameters
                })
            
            if not actions:
                return AIProviderResult.failure(
                    message="No valid actions found",
                    error="NO_ACTIONS"
                ).to_dict()
            
            print(f"[Function Calling] Multiple actions: {[a['action'] for a in actions]}")
            
            return AIProviderResult.success_multiple(
                actions=actions,
                message=f"Executing {len(actions)} actions",
                confidence=1.0
            ).to_dict()
            
        except Exception as e:
            error_str = str(e).lower()
            error_full = str(e)
            print(f"[Function Calling] Exception: {error_full}")
            
            is_rate_limit = (
                "429" in error_str or 
                ("quota" in error_str and "exceeded" in error_str) or
                "rate limit" in error_str or
                "resource exhausted" in error_str or
                "too many requests" in error_str
            )
            
            if is_rate_limit:
                return AIProviderResult.failure(
                    message=f"Rate limit exceeded. Please wait and try again.",
                    error="RATE_LIMIT_EXCEEDED"
                ).to_dict()
            else:
                return AIProviderResult.failure(
                    message=f"Gemini API error: {error_full}",
                    error="AI_ERROR"
                ).to_dict()
    
    def _apply_defaults(self, action: str, parameters: Dict[str, Any]) -> Dict[str, Any]:
        """Apply sensible defaults for missing optional parameters."""
        params = dict(parameters)  # Copy to avoid mutation
        
        if action == "zoomIn":
            if "endScale" not in params:
                params["endScale"] = 150
            if "animated" not in params:
                params["animated"] = False
                
        elif action == "zoomOut":
            if "endScale" not in params:
                params["endScale"] = 100
            if "animated" not in params:
                params["animated"] = False
                
        elif action == "applyBlur":
            if "blurAmount" not in params:
                params["blurAmount"] = 50
                
        elif action == "applyTransition":
            if "duration" not in params:
                params["duration"] = 1.0
            if "applyToStart" not in params:
                params["applyToStart"] = True
        
        return params
    
    def process_question(self, messages: List[Dict[str, str]]) -> Dict[str, Any]:
        """
        Process a question/chat request with conversation history.
        This is separate from action extraction - used for question answering.
        
        Args:
            messages: List of message dicts with 'role' ('user'|'assistant') and 'content'
        
        Returns:
            {
                "message": str,              # Answer text
                "error": str | None          # Error code if failed
            }
        """
        if not self.is_configured():
            return {
                "message": "Gemini API not configured. Please set GEMINI_API_KEY.",
                "error": "API_KEY_MISSING"
            }
        
        try:
            # Get Gemini model
            model_name = self.model_name.replace("models/", "") if self.model_name.startswith("models/") else self.model_name
            model = genai.GenerativeModel(model_name)
            
            # Get Premiere Pro system prompt
            system_prompt = self._get_premiere_question_system_prompt()
            
            # Format conversation history for Gemini
            # Gemini expects messages in format: [{"role": "user", "parts": ["text"]}, ...]
            formatted_history = []
            for msg in messages[-10:]:  # Last 10 messages for context
                role = msg.get('role', 'user')
                content = str(msg.get('content', ''))
                
                # Convert role format: 'user' -> 'user', 'assistant' -> 'model'
                gemini_role = 'model' if role == 'assistant' else 'user'
                formatted_history.append({
                    "role": gemini_role,
                    "parts": [content]
                })
            
            # Log conversation info
            print(f"[Question] Processing {len(formatted_history)} messages")
            
            # Configure generation with token limits
            # Use genai.types.GenerationConfig if available, otherwise dict
            try:
                from google.generativeai import types
                generation_config = types.GenerationConfig(
                    max_output_tokens=400,  # Limit to ~400 tokens for concise responses
                    temperature=0.7  # Balanced creativity
                )
            except (ImportError, AttributeError):
                # Fallback to dict format
                generation_config = {
                    "max_output_tokens": 400,
                    "temperature": 0.7
                }
            
            # Build the full prompt with system instruction and conversation
            # For Gemini, we prepend system prompt to the first user message
            if formatted_history:
                # Prepend system prompt to conversation
                full_prompt = f"{system_prompt}\n\n"
                # Add conversation history
                for msg in formatted_history:
                    role_label = "User" if msg["role"] == "user" else "Assistant"
                    full_prompt += f"{role_label}: {msg['parts'][0]}\n\n"
                full_prompt += "Assistant:"
            else:
                full_prompt = f"{system_prompt}\n\nUser: (No conversation history)\n\nAssistant:"
            
            # Generate response with retry logic
            max_retries = 3
            retry_delay = 1
            response_text = None
            last_error = None
            
            print(f"[Question] Making request to Gemini API (model: {model_name})")
            
            for attempt in range(max_retries):
                try:
                    response = model.generate_content(
                        full_prompt,
                        generation_config=generation_config
                    )
                    response_text = response.text.strip()
                    print(f"[Question] ✅ Success on attempt {attempt + 1}")
                    break
                except Exception as e:
                    last_error = e
                    error_str = str(e).lower()
                    error_full = str(e)
                    
                    print(f"[Question] ❌ Error on attempt {attempt + 1}: {error_full}")
                    
                    # Check if it's a rate limit error
                    is_rate_limit = (
                        "429" in error_str or 
                        ("quota" in error_str and "exceeded" in error_str) or
                        "rate limit" in error_str or
                        ("resource exhausted" in error_str) or
                        ("too many requests" in error_str)
                    )
                    
                    if is_rate_limit:
                        if attempt < max_retries - 1:
                            wait_time = retry_delay * (2 ** attempt)
                            print(f"[Question] Rate limit hit. Waiting {wait_time}s before retry...")
                            time.sleep(wait_time)
                            retry_delay = wait_time
                        else:
                            print(f"[Question] All retry attempts exhausted.")
                            raise
                    else:
                        # Not a rate limit error, don't retry
                        print(f"[Question] Non-rate-limit error, not retrying: {error_full}")
                        raise
            
            if response_text is None:
                error_msg = str(last_error) if last_error else "Unknown error"
                error_msg_lower = error_msg.lower()
                is_rate_limit = (
                    "429" in error_msg or 
                    ("quota" in error_msg_lower and "exceeded" in error_msg_lower) or
                    "rate limit" in error_msg_lower or
                    "resource exhausted" in error_msg_lower or
                    "too many requests" in error_msg_lower
                )
                
                if is_rate_limit:
                    return {
                        "message": "⚠️ Rate limit exceeded. Please wait a few minutes and try again.",
                        "error": "RATE_LIMIT_EXCEEDED"
                    }
                else:
                    return {
                        "message": f"Error processing question: {error_msg}",
                        "error": "AI_ERROR"
                    }
            
            # Validate response
            if not response_text or len(response_text.strip()) == 0:
                return {
                    "message": "I'm not sure how to answer that. Could you rephrase your question?",
                    "error": None
                }
            
            # Return successful response
            return {
                "message": response_text,
                "error": None
            }
            
        except Exception as e:
            error_str = str(e).lower()
            error_full = str(e)
            print(f"[Question] Exception: {error_full}")
            
            # Check for rate limits
            is_rate_limit = (
                "429" in error_str or 
                ("quota" in error_str and "exceeded" in error_str) or
                "rate limit" in error_str or
                "resource exhausted" in error_str or
                "too many requests" in error_str
            )
            
            if is_rate_limit:
                return {
                    "message": "⚠️ Rate limit exceeded. Please wait a moment and try again.",
                    "error": "RATE_LIMIT_EXCEEDED"
                }
            else:
                return {
                    "message": f"Error processing question: {error_full}",
                    "error": "AI_ERROR"
                }
    
    def _get_premiere_question_system_prompt(self) -> str:
        """Get the system prompt for Premiere Pro question answering"""
        return """You are a helpful Premiere Pro assistant. Answer questions about Premiere Pro workflows, features, and techniques.

RESPONSE GUIDELINES:
- Keep answers concise (2-4 sentences max)
- Provide step-by-step instructions when applicable
- Reference specific UI elements and menu paths
- Focus on practical, actionable guidance
- If unsure, acknowledge limitations politely

KEY PREMIERE PRO KNOWLEDGE:

UI NAVIGATION:
- Effects Panel: Window > Effects (or Shift+7)
- Project Panel: Window > Project (or Shift+1)
- Timeline: Window > Timeline (or Shift+2)
- Source/Program Monitors: Window > Source Monitor / Program Monitor
- Essential Graphics: Window > Essential Graphics
- Lumetri Color: Window > Lumetri Color

COMMON WORKFLOWS:
- Cutting clips: Razor Tool (C), or Cmd+K (Mac) / Ctrl+K (Windows)
- Trimming: Selection Tool (V), drag clip edges
- Adding effects: Drag from Effects panel to clip
- Color correction: Lumetri Color panel or Effects > Color Correction
- Audio mixing: Audio Track Mixer or Essential Sound panel
- Export: File > Export > Media (Cmd+M / Ctrl+M)

EFFECTS LOCATIONS:
- Video Effects: Effects panel > Video Effects
- Audio Effects: Effects panel > Audio Effects
- Transitions: Effects panel > Video Transitions / Audio Transitions
- Common effects: Blur, Color Correction, Distort, Keying, Noise Reduction

KEYBOARD SHORTCUTS:
- Play/Pause: Spacebar
- Cut: Cmd+K / Ctrl+K
- Razor Tool: C
- Selection Tool: V
- Zoom Timeline: +/- or scroll
- Undo: Cmd+Z / Ctrl+Z
- Save: Cmd+S / Ctrl+S

COLOR GRADING:
- Lumetri Color panel: Primary color correction, curves, HSL
- Color Wheels: Shadows, Midtones, Highlights
- Scopes: Window > Lumetri Scopes (Waveform, Vectorscope, Histogram)
- Presets: Lumetri Color > Creative > Look

AUDIO BASICS:
- Adjust volume: Select clip > Audio > Volume
- Keyframe audio: Right-click audio clip > Show Clip Keyframes
- Audio Mixer: Window > Audio Track Mixer
- Essential Sound: Window > Essential Sound (auto-ducking, noise reduction)

EXPORT SETTINGS:
- H.264: Good for web (YouTube, Vimeo)
- ProRes: High quality, large files (professional workflows)
- Match Source: Uses sequence settings
- Custom: Adjust bitrate, resolution, frame rate

TROUBLESHOOTING:
- Playback issues: Lower playback resolution, enable Mercury Playback Engine
- Audio sync: Check frame rate, use Synchronize Clips
- Missing effects: Check Effects panel, may need to install
- Slow performance: Clear media cache, reduce preview quality

Remember: Be concise, practical, and helpful. Focus on what the user needs to know."""
