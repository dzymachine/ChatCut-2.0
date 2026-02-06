"""
Groq AI Provider Implementation

Concrete implementation of AIProvider using Groq's API.
Groq offers extremely fast inference with generous free tier limits.

Free tier limits (as of 2025):
- 30 requests per minute
- 14,400 requests per day
- Supports function calling (tool use)

Models available:
- llama-3.3-70b-versatile (recommended for quality)
- llama-3.1-8b-instant (faster, lighter)
- qwen/qwen3-32b
- meta-llama/llama-4-scout-17b-16e-instruct
"""
import os
import json
import time
from typing import Dict, Any, Optional, List
from .redis_cache import RedisCache
try:
    from groq import Groq
    GROQ_AVAILABLE = True
except ImportError:
    GROQ_AVAILABLE = False

from ..ai_provider import AIProvider, AIProviderResult


class GroqProvider(AIProvider):
    """Groq AI provider implementation with function calling support"""
    
    def __init__(self, api_key: Optional[str] = None):
        """
        Initialize Groq provider
        
        Args:
            api_key: Groq API key (if None, reads from GROQ_API_KEY env var)
        """
        self.api_key = api_key or os.getenv("GROQ_API_KEY")
        # Default to llama-3.3-70b-versatile for best quality with tool use
        # Alternative: llama-3.1-8b-instant for faster/lighter requests
        self.model_name = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
        self._client = None
        self._configured = False
        self.cache = RedisCache()

        if self.api_key and GROQ_AVAILABLE:
            try:
                self._client = Groq(api_key=self.api_key)
                self._configured = True
            except Exception as e:
                print(f"⚠️  Warning: Failed to configure Groq: {e}")
    
    def is_configured(self) -> bool:
        """Check if Groq is properly configured"""
        return self._configured and GROQ_AVAILABLE and self.api_key is not None
    
    def get_provider_name(self) -> str:
        """Get provider name"""
        return "groq"
    
    def _convert_gemini_schema_to_groq(self, gemini_declarations: List[Dict]) -> List[Dict]:
        """
        Convert Gemini function declarations to Groq/OpenAI tool format.
        
        Gemini format:
        {
            "name": "zoomIn",
            "description": "...",
            "parameters": {"type": "object", "properties": {...}, "required": [...]}
        }
        
        Groq format (OpenAI-compatible):
        {
            "type": "function",
            "function": {
                "name": "zoomIn",
                "description": "...",
                "parameters": {"type": "object", "properties": {...}, "required": [...]}
            }
        }
        """
        tools = []
        for decl in gemini_declarations:
            tool = {
                "type": "function",
                "function": {
                    "name": decl["name"],
                    "description": decl.get("description", ""),
                    "parameters": decl.get("parameters", {"type": "object", "properties": {}})
                }
            }
            tools.append(tool)
        return tools
    
    def process_prompt(self, user_prompt: str, context_params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Process user prompt using Groq's tool calling API.
        
        Uses the same function schemas as Gemini for consistency.
        """
        if not self.is_configured():
            return AIProviderResult.failure(
                message="Groq API not configured. Please set GROQ_API_KEY.",
                error="API_KEY_MISSING"
            ).to_dict()
        
        # Check cache
        cached = self.cache.get_similar(user_prompt, context_params)  # ← Changed from .get()
        if cached:
            print("[Groq] Cache hit")
            return cached
        
        try:
            from .function_schemas import get_function_declarations, FUNCTION_CALLING_SYSTEM_PROMPT
            
            # Convert Gemini function declarations to Groq/OpenAI format
            gemini_declarations = get_function_declarations()
            tools = self._convert_gemini_schema_to_groq(gemini_declarations)
            
            # Format context if available
            prompt = user_prompt
            if context_params:
                context_str = f"\nContext - current effect parameters: {json.dumps(context_params)}"
                prompt = f"{user_prompt}{context_str}"
            
            print(f"[Groq] Making request to Groq API (model: {self.model_name})")
            print(f"[Groq] Prompt: {prompt[:100]}...")
            
            # Build messages
            messages = [
                {"role": "system", "content": FUNCTION_CALLING_SYSTEM_PROMPT},
                {"role": "user", "content": prompt}
            ]
            
            # Generate response with tool calling and retry logic
            max_retries = 3
            retry_delay = 1
            response = None
            last_error = None
            
            for attempt in range(max_retries):
                try:
                    response = self._client.chat.completions.create(
                        model=self.model_name,
                        messages=messages,
                        tools=tools,
                        tool_choice="auto",
                        max_tokens=1024
                    )
                    print(f"[Groq] ✅ Success on attempt {attempt + 1}")
                    break
                except Exception as e:
                    last_error = e
                    error_str = str(e).lower()
                    error_full = str(e)
                    
                    print(f"[Groq] ❌ Error on attempt {attempt + 1}: {error_full}")
                    
                    is_rate_limit = (
                        "429" in error_str or 
                        "rate_limit" in error_str or
                        "rate limit" in error_str or
                        "too many requests" in error_str or
                        "quota" in error_str
                    )
                    
                    if is_rate_limit and attempt < max_retries - 1:
                        wait_time = retry_delay * (2 ** attempt)
                        print(f"[Groq] Rate limit hit. Waiting {wait_time}s...")
                        time.sleep(wait_time)
                    else:
                        raise
            
            if response is None:
                error_msg = str(last_error) if last_error else "Unknown error"
                return AIProviderResult.failure(
                    message=f"Groq API error: {error_msg}",
                    error="AI_ERROR"
                ).to_dict()
            
            # Extract response
            choice = response.choices[0]
            message = choice.message
            
            # Check for tool calls
            if message.tool_calls:
                function_calls = []
                for tool_call in message.tool_calls:
                    fc = tool_call.function
                    # Parse arguments from JSON string
                    try:
                        args = json.loads(fc.arguments) if fc.arguments else {}
                    except json.JSONDecodeError:
                        args = {}
                    
                    function_calls.append({
                        "name": fc.name,
                        "args": args
                    })
                
                print(f"[Groq] Got {len(function_calls)} function call(s)")
                
                # Handle askClarification specially
                if len(function_calls) == 1 and function_calls[0]["name"] == "askClarification":
                    args = function_calls[0]["args"]
                    clarification_message = args.get("message", "Could you clarify what you'd like to do?")
                    suggestions = args.get("suggestions", [])
                    if suggestions:
                        clarification_message += "\n\nOptions: " + ", ".join(suggestions)
                    return AIProviderResult.failure(
                        message=clarification_message,
                        error="NEEDS_SPECIFICATION"
                    ).to_dict()
                
                # Single function call
                if len(function_calls) == 1:
                    fc = function_calls[0]
                    action = fc["name"]
                    parameters = fc["args"]
                    
                    # Apply defaults for optional parameters
                    parameters = self._apply_defaults(action, parameters)
                    
                    print(f"[Groq] Action: {action}, Parameters: {parameters}")
                    
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
                
                print(f"[Groq] Multiple actions: {[a['action'] for a in actions]}")
                
                return AIProviderResult.success_multiple(
                    actions=actions,
                    message=f"Executing {len(actions)} actions",
                    confidence=1.0
                ).to_dict()
            
            # No tool calls - text response
            text_response = message.content
            if text_response:
                print(f"[Groq] Text response (no function): {text_response[:100]}...")
                return AIProviderResult.failure(
                    message=text_response,
                    error="NEEDS_SPECIFICATION"
                ).to_dict()
            else:
                return AIProviderResult.failure(
                    message="Could not understand the request. Please try rephrasing.",
                    error="NO_FUNCTION_CALL"
                ).to_dict()
            
        except Exception as e:
            error_str = str(e).lower()
            error_full = str(e)
            print(f"[Groq] Exception: {error_full}")
            
            is_rate_limit = (
                "429" in error_str or 
                "rate_limit" in error_str or
                "rate limit" in error_str or
                "too many requests" in error_str or
                "quota" in error_str
            )
            
            if is_rate_limit:
                return AIProviderResult.failure(
                    message="Rate limit exceeded. Please wait and try again.",
                    error="RATE_LIMIT_EXCEEDED"
                ).to_dict()
            else:
                return AIProviderResult.failure(
                    message=f"Groq API error: {error_full}",
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
                "message": "Groq API not configured. Please set GROQ_API_KEY.",
                "error": "API_KEY_MISSING"
            }
        
        try:
            # Get Premiere Pro system prompt
            system_prompt = self._get_premiere_question_system_prompt()
            
            # Format conversation history for Groq (OpenAI format)
            formatted_messages = [
                {"role": "system", "content": system_prompt}
            ]
            
            for msg in messages[-10:]:  # Last 10 messages for context
                role = msg.get('role', 'user')
                content = str(msg.get('content', ''))
                formatted_messages.append({
                    "role": role,
                    "content": content
                })
            
            print(f"[Groq Question] Processing {len(formatted_messages) - 1} messages")
            
            # Generate response with retry logic
            max_retries = 3
            retry_delay = 1
            response_text = None
            last_error = None
            
            print(f"[Groq Question] Making request to Groq API (model: {self.model_name})")
            
            for attempt in range(max_retries):
                try:
                    response = self._client.chat.completions.create(
                        model=self.model_name,
                        messages=formatted_messages,
                        max_tokens=400,  # Limit for concise responses
                        temperature=0.7
                    )
                    response_text = response.choices[0].message.content.strip()
                    print(f"[Groq Question] ✅ Success on attempt {attempt + 1}")
                    break
                except Exception as e:
                    last_error = e
                    error_str = str(e).lower()
                    error_full = str(e)
                    
                    print(f"[Groq Question] ❌ Error on attempt {attempt + 1}: {error_full}")
                    
                    is_rate_limit = (
                        "429" in error_str or 
                        "rate_limit" in error_str or
                        "rate limit" in error_str or
                        "too many requests" in error_str or
                        "quota" in error_str
                    )
                    
                    if is_rate_limit:
                        if attempt < max_retries - 1:
                            wait_time = retry_delay * (2 ** attempt)
                            print(f"[Groq Question] Rate limit hit. Waiting {wait_time}s before retry...")
                            time.sleep(wait_time)
                            retry_delay = wait_time
                        else:
                            print(f"[Groq Question] All retry attempts exhausted.")
                            raise
                    else:
                        print(f"[Groq Question] Non-rate-limit error, not retrying: {error_full}")
                        raise
            
            if response_text is None:
                error_msg = str(last_error) if last_error else "Unknown error"
                error_msg_lower = error_msg.lower()
                is_rate_limit = (
                    "429" in error_msg or 
                    "rate_limit" in error_msg_lower or
                    "rate limit" in error_msg_lower or
                    "too many requests" in error_msg_lower or
                    "quota" in error_msg_lower
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
            print(f"[Groq Question] Exception: {error_full}")
            
            is_rate_limit = (
                "429" in error_str or 
                "rate_limit" in error_str or
                "rate limit" in error_str or
                "too many requests" in error_str or
                "quota" in error_str
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

Remember: Be concise, practical, and helpful. Focus on what the user needs to know."""
