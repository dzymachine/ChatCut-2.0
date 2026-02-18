"""
AI Service - Provider-agnostic AI processing

This service uses the AI provider abstraction layer to process prompts.
The provider can be switched via configuration without code changes.
"""
import os
from typing import Dict, Any, Optional

from .ai_provider import AIProvider
from .providers import GeminiProvider, GroqProvider

# Provider factory - switch providers here
_PROVIDER_INSTANCE: AIProvider = None


def _get_provider() -> AIProvider:
    """
    Get the configured AI provider instance.
    Always creates fresh instance to ensure env vars are loaded.
    """
    global _PROVIDER_INSTANCE
    
    provider_type = os.getenv("AI_PROVIDER", "gemini").lower()
    
    # Always create new instance to pick up env changes (dotenv loads before this)

    if _PROVIDER_INSTANCE is None:
        if provider_type == "gemini":
            _PROVIDER_INSTANCE = GeminiProvider()
        elif provider_type == "groq":
            _PROVIDER_INSTANCE = GroqProvider()
        else:
            raise ValueError(f"Unknown AI provider: {provider_type}. Supported: gemini, groq")
        
    if not _PROVIDER_INSTANCE.is_configured():
        if provider_type == "gemini":
            api_key = os.getenv("GEMINI_API_KEY")
            if not api_key or api_key == "your_gemini_api_key_here":
                print(f"⚠️  WARNING: GEMINI_API_KEY not set. Please set GEMINI_API_KEY in .env file")
            else:
                print(f"⚠️  WARNING: Gemini provider configured but API key may be invalid. Key length: {len(api_key)}")
        elif provider_type == "groq":
            api_key = os.getenv("GROQ_API_KEY")
            if not api_key or api_key == "your_groq_api_key_here":
                print(f"⚠️  WARNING: GROQ_API_KEY not set. Please set GROQ_API_KEY in .env file")
            else:
                print(f"⚠️  WARNING: Groq provider configured but API key may be invalid. Key length: {len(api_key)}")
    
    return _PROVIDER_INSTANCE


def process_prompt(user_prompt: str, context_params: Dict[str, Any] = None, client_type: str = "premiere") -> Dict[str, Any]:
    """
    Process user prompt and extract structured action with parameters.
    
    This function uses the configured AI provider to extract actions.
    The provider can be switched via AI_PROVIDER environment variable.
    
    Args:
        user_prompt: Natural language user request (e.g., "zoom in by 120%")
        context_params: Optional context parameters (e.g., selected effect settings)
        client_type: "premiere" for plugin, "desktop" for standalone editor
    
    Returns:
        {
            "action": str,  # e.g., "zoomIn", "zoomOut"
            "parameters": dict,  # e.g., {"endScale": 120, "animated": false}
            "confidence": float,  # 0.0 to 1.0
            "message": str  # Human-readable explanation
        }
    """
    preprocessed = _maybe_handle_color_request(user_prompt)
    if preprocessed:
        return preprocessed

    provider = _get_provider()
    return provider.process_prompt(user_prompt, context_params, client_type=client_type)


def _maybe_handle_color_request(user_prompt: str) -> Optional[Dict[str, Any]]:
    """
    Fast-path color requests to adjustColor to avoid filter ambiguity.
    Returns a response dict when a match is found, else None.
    """
    if not user_prompt:
        return None

    prompt = user_prompt.lower()
    color_defaults = {
        "exposure": 0.5,
        "contrast": 10,
        "highlights": 10,
        "shadows": 10,
        "whites": 10,
        "blacks": 10,
        "saturation": 10,
        "vibrance": 10,
        "temperature": 5,
        "tint": 5
    }

    preset_map = {
        "cinematic": {"contrast": 15, "shadows": -10, "highlights": -10, "saturation": -5, "vibrance": 10},
        "dramatic": {"contrast": 20, "shadows": -15, "highlights": -10, "vibrance": 15},
        "warm": {"temperature": 10, "tint": 2, "saturation": 5},
        "cool": {"temperature": -10, "tint": -2, "saturation": 5}
    }

    synonym_map = {
        "brighter": {"exposure": 0.5},
        "brighten": {"exposure": 0.5},
        "darker": {"exposure": -0.5},
        "darken": {"exposure": -0.5},
        "warmer": {"temperature": 5},
        "cooler": {"temperature": -5}
    }

    # Preset keywords (relative adjustments)
    for preset_key, preset_params in preset_map.items():
        if preset_key in prompt and ("look" in prompt or "apply" in prompt or "make" in prompt):
            return {
                "action": "adjustColor",
                "parameters": {"relative": True, **preset_params},
                "confidence": 1.0,
                "message": "Executing adjustColor"
            }

    if not any(key in prompt for key in color_defaults):
        for synonym_key, synonym_params in synonym_map.items():
            if synonym_key in prompt:
                return {
                    "action": "adjustColor",
                    "parameters": {"relative": True, **synonym_params},
                    "confidence": 1.0,
                    "message": "Executing adjustColor"
                }
        return None

    increase_words = ["increase", "raise", "boost", "more", "up"]
    decrease_words = ["decrease", "lower", "reduce", "less", "down"]
    set_words = ["set", "to", "at", "equals", "=", "is"]

    is_set = any(word in prompt for word in set_words)
    direction = None
    if any(word in prompt for word in increase_words):
        direction = 1
    elif any(word in prompt for word in decrease_words):
        direction = -1

    if not is_set and direction is None:
        return None

    params: Dict[str, Any] = {"relative": not is_set}
    for key, default_delta in color_defaults.items():
        if key in prompt:
            delta = default_delta

            # Try to extract a specific number for this key (e.g., "increase exposure by 2")
            match = None
            try:
                import re
                pattern = rf"{key}[^0-9-]*(-?\d+(?:\.\d+)?)"
                match = re.search(pattern, prompt)
            except Exception:
                match = None

            if match:
                try:
                    delta = float(match.group(1))
                except ValueError:
                    delta = default_delta

            if is_set:
                params[key] = delta
            else:
                # Apply direction to the delta (increase/decrease)
                params[key] = abs(delta) * direction

    if len(params) == 1:
        return None

    return {
        "action": "adjustColor",
        "parameters": params,
        "confidence": 1.0,
        "message": "Executing adjustColor"
    }


def get_available_actions() -> Dict[str, Dict[str, Any]]:
    """
    Returns a registry of available actions and their parameter schemas.
    This helps the AI understand what actions are available.
    
    Note: This is provider-agnostic and describes the system's capabilities,
    not provider-specific features.
    """
    return {
        "zoomIn": {
            "description": "Zoom in on video clip",
            "parameters": {
                "endScale": {"type": "number", "default": 150, "description": "Target zoom scale as percentage"},
                "startScale": {"type": "number", "default": 100, "description": "Starting zoom scale"},
                "animated": {"type": "boolean", "default": True, "description": "Whether to animate zoom"},
                "duration": {"type": "number", "default": None, "description": "Duration in seconds"},
                "startTime": {"type": "number", "default": 0, "description": "Start time in seconds relative to clip start"},
                "interpolation": {"type": "string", "default": "BEZIER", "enum": ["LINEAR", "BEZIER", "HOLD", "EASE_IN", "EASE_OUT"]}
            }
        },
        "zoomOut": {
            "description": "Zoom out on video clip",
            "parameters": {
                "endScale": {"type": "number", "default": 100, "description": "Target zoom scale as percentage"},
                "startScale": {"type": "number", "default": 150, "description": "Starting zoom scale"},
                "animated": {"type": "boolean", "default": True, "description": "Whether to animate zoom"},
                "duration": {"type": "number", "default": None, "description": "Duration in seconds"},
                "startTime": {"type": "number", "default": 0, "description": "Start time in seconds relative to clip start"},
                "interpolation": {"type": "string", "default": "BEZIER", "enum": ["LINEAR", "BEZIER", "HOLD", "EASE_IN", "EASE_OUT"]}
            }
        },
        "applyFilter": {
            "description": "Apply a video filter effect",
            "parameters": {
                "filterName": {"type": "string", "required": True, "description": "Name of the filter to apply"}
            }
        },
        "applyTransition": {
            "description": "Apply a transition effect",
            "parameters": {
                "transitionName": {"type": "string", "required": True, "description": "Name of the transition"},
                "duration": {"type": "number", "default": 1.0, "description": "Duration in seconds"},
                "applyToStart": {"type": "boolean", "default": True, "description": "Apply to start of clip"},
                "transitionAlignment": {"type": "number", "default": 0.5, "description": "Alignment of the transition (0.0=start, 0.5=center, 1.0=end)"}
            }
        },
        "applyBlur": {
            "description": "Apply a Gaussian blur to the clip",
            "parameters": {
                "blurAmount": {"type": "number", "default": 50, "description": "Blurriness amount (e.g., 0-500)"}
            }
        },
        "modifyParameter": {
            "description": "Modify effect parameter(s) on a clip after an effect has been applied. Supports keyframe animation.",
            "parameters": {
                "parameterName": {"type": "string", "required": True, "description": "Name of the parameter to modify (e.g., 'Horizontal Blocks', 'Blurriness', 'Opacity')"},
                "value": {"type": "number", "required": True, "description": "Target value (or static value if not animated)"},
                "startValue": {"type": "number", "description": "Starting value for animation (if animated=true)"},
                "animated": {"type": "boolean", "default": False, "description": "Whether to animate the parameter change over time"},
                "duration": {"type": "number", "default": None, "description": "Duration of the animation in seconds (null = entire clip)"},
                "startTime": {"type": "number", "default": 0, "description": "Start time of the animation in seconds relative to clip start"},
                "interpolation": {"type": "string", "default": "LINEAR", "enum": ["LINEAR", "BEZIER", "HOLD", "EASE_IN", "EASE_OUT"]},
                "componentName": {"type": "string", "default": None, "description": "Optional: Name of the effect/component containing the parameter"},
                "excludeBuiltIn": {"type": "boolean", "default": True, "description": "Whether to exclude built-in effects like Motion/Opacity"},
                "modifications": {"type": "array", "default": None, "description": "For batch modification: array of {parameterName, value, componentName?} objects"}
            },
            "examples": [
                "Set mosaic blocks to 20",
                "Increase blur from 0 to 50 over 2 seconds",
                "Fade opacity to 0 at the end",
                "Animate brightness from 0 to 100"
            ]
        },
        "getParameters": {
            "description": "Get list of all available effect parameters on the selected clip(s)",
            "parameters": {},
            "examples": [
                "What parameters can I change?",
                "Show me the effect settings",
                "List available parameters"
            ]
        },
        "applyAudioFilter": {
            "description": "Apply an audio effect/filter to an audio clip",
            "parameters": {
                "filterDisplayName": {"type": "string", "required": True, "description": "Display name of the audio filter (e.g., 'Parametric EQ', 'Reverb', 'DeNoise')"}
            }
        },
        "adjustVolume": {
            "description": "Adjust the volume of an audio clip",
            "parameters": {
                "volumeDb": {"type": "number", "required": True, "description": "Volume adjustment in decibels (positive = louder, negative = quieter, e.g., 3 = +3dB louder, -6 = -6dB quieter)"}
            }
        }
    }


def get_provider_info() -> Dict[str, Any]:
    """
    Get information about the currently configured provider
    """
    try:
        provider = _get_provider()
        return {
            "provider": provider.get_provider_name(),
            "configured": provider.is_configured()
        }
    except Exception as e:
        return {
            "provider": "unknown",
            "configured": False,
            "error": str(e)
        }
