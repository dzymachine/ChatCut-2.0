"""
Function Calling Schemas for ChatCut Desktop Editor

These schemas use the ChatCut effect system IDs (not Premiere Pro matchNames).
They are used when the client_type is "desktop" (the standalone NLE editor).

Each function maps to an effect in the ChatCut effect registry.
The parameter names match the EffectDescriptor parameter IDs in:
  web/src/lib/effects/registry.ts
"""

# All available effect IDs in the ChatCut desktop editor
DESKTOP_EFFECTS = [
    # Transform (5)
    "scale",
    "position",
    "rotation",
    "opacity",
    "crop",
    # Color Correction (7)
    "brightness",
    "contrast",
    "saturation",
    "exposure",
    "color_temperature",
    "hue_rotate",
    "grayscale",
    # Blur / Sharpen (2)
    "gaussian_blur",
    "sharpen",
    # Style (2)
    "sepia",
    "vignette",
    # Transitions (3)
    "cross_dissolve",
    "fade_out",
    "fade_in",
    # Speed (1)
    "playback_speed",
]


def get_desktop_function_declarations():
    """
    Returns function declarations for the ChatCut desktop editor.
    These use effect IDs from the ChatCut effect registry.
    """
    return [
        # ── Zoom / Scale ──
        {
            "name": "set_zoom",
            "description": "Set the zoom/scale level of the video clip. Use for 'zoom in', 'zoom out', 'scale up/down', 'punch in'. Scale 1.0 = 100%, 1.5 = 150% (zoom in), 0.5 = 50% (zoom out).",
            "parameters": {
                "type": "object",
                "properties": {
                    "scale_percent": {
                        "type": "number",
                        "description": "Target zoom as a percentage. 100 = normal, 150 = zoomed in 50%, 200 = 2x zoom. Default 150 for 'zoom in', 100 for 'zoom out'."
                    },
                    "animated": {
                        "type": "boolean",
                        "description": "True for animated zoom (ken burns). False for instant. Default false."
                    },
                    "duration": {
                        "type": "number",
                        "description": "Animation duration in seconds. Only if user specifies."
                    }
                },
                "required": []
            }
        },
        # ── Position / Pan ──
        {
            "name": "set_position",
            "description": "Set the position/pan of the video. Use for 'move left/right/up/down', 'pan', 'reposition'. Values are in pixels from center (0,0).",
            "parameters": {
                "type": "object",
                "properties": {
                    "x": {
                        "type": "number",
                        "description": "Horizontal position in pixels. Positive = right, negative = left. Default 0."
                    },
                    "y": {
                        "type": "number",
                        "description": "Vertical position in pixels. Positive = down, negative = up. Default 0."
                    },
                    "animated": {
                        "type": "boolean",
                        "description": "True for animated pan. Default false."
                    },
                    "duration": {
                        "type": "number",
                        "description": "Animation duration in seconds."
                    }
                },
                "required": []
            }
        },
        # ── Rotation ──
        {
            "name": "set_rotation",
            "description": "Rotate the video clip. Use for 'rotate', 'tilt', 'turn'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "degrees": {
                        "type": "number",
                        "description": "Rotation angle in degrees. Positive = clockwise. Default 0."
                    },
                    "animated": {
                        "type": "boolean",
                        "description": "True for animated rotation. Default false."
                    },
                    "duration": {
                        "type": "number",
                        "description": "Animation duration in seconds."
                    }
                },
                "required": ["degrees"]
            }
        },
        # ── Opacity ──
        {
            "name": "set_opacity",
            "description": "Set the opacity/transparency of the video clip. Use for 'make transparent', 'fade', 'opacity'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "value": {
                        "type": "number",
                        "description": "Opacity as percentage. 100 = fully opaque, 50 = 50% transparent, 0 = invisible."
                    },
                    "animated": {
                        "type": "boolean",
                        "description": "True for animated opacity change (fade). Default false."
                    },
                    "duration": {
                        "type": "number",
                        "description": "Animation duration in seconds."
                    }
                },
                "required": ["value"]
            }
        },
        # ── Crop ──
        {
            "name": "set_crop",
            "description": "Crop the video to a specific region. Use for 'crop', 'cut edges', 'trim frame'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "width": {
                        "type": "number",
                        "description": "Crop width in pixels."
                    },
                    "height": {
                        "type": "number",
                        "description": "Crop height in pixels."
                    },
                    "x": {
                        "type": "number",
                        "description": "X offset for crop origin (from left). Default 0."
                    },
                    "y": {
                        "type": "number",
                        "description": "Y offset for crop origin (from top). Default 0."
                    }
                },
                "required": ["width", "height"]
            }
        },
        # ── Brightness ──
        {
            "name": "brightness",
            "description": "Adjust brightness. Use for 'brighten', 'darken', 'make brighter/darker'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "value": {
                        "type": "number",
                        "description": "Brightness as percentage. 100 = normal. 120 = 20% brighter. 80 = 20% darker."
                    }
                },
                "required": ["value"]
            }
        },
        # ── Contrast ──
        {
            "name": "contrast",
            "description": "Adjust contrast. Use for 'increase/decrease contrast', 'more/less punchy'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "value": {
                        "type": "number",
                        "description": "Contrast as percentage. 100 = normal. 150 = high contrast. 50 = low contrast."
                    }
                },
                "required": ["value"]
            }
        },
        # ── Saturation ──
        {
            "name": "saturation",
            "description": "Adjust color saturation. Use for 'more/less colorful', 'desaturate', 'vivid'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "value": {
                        "type": "number",
                        "description": "Saturation as percentage. 100 = normal. 0 = fully desaturated. 200 = very vivid."
                    }
                },
                "required": ["value"]
            }
        },
        # ── Exposure ──
        {
            "name": "set_exposure",
            "description": "Adjust exposure. Use for 'exposure up/down', 'overexpose', 'underexpose'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "value": {
                        "type": "number",
                        "description": "Exposure value. 0 = normal. Positive = brighter. Negative = darker. Range -3 to 3."
                    }
                },
                "required": ["value"]
            }
        },
        # ── Color Temperature ──
        {
            "name": "set_color_temperature",
            "description": "Adjust color temperature (warm/cool). Use for 'warmer', 'cooler', 'white balance'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "temperature": {
                        "type": "number",
                        "description": "Color temperature in Kelvin. 6500 = neutral daylight. Lower = warmer/orange. Higher = cooler/blue. Range 1000-12000."
                    }
                },
                "required": ["temperature"]
            }
        },
        # ── Hue Rotate ──
        {
            "name": "hue_rotate",
            "description": "Rotate the color hue. Use for 'shift colors', 'hue shift', 'change hue'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "degrees": {
                        "type": "number",
                        "description": "Hue rotation in degrees. 0 = no change. 180 = opposite colors. Range -180 to 180."
                    }
                },
                "required": ["degrees"]
            }
        },
        # ── Grayscale ──
        {
            "name": "grayscale",
            "description": "Convert to grayscale (black and white). Use for 'black and white', 'desaturate', 'monochrome'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "value": {
                        "type": "number",
                        "description": "Grayscale amount as percentage. 100 = fully B&W. 50 = partial. 0 = none."
                    }
                },
                "required": []
            }
        },
        # ── Blur ──
        {
            "name": "set_blur",
            "description": "Apply gaussian blur. Use for 'blur', 'soften', 'out of focus'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "amount": {
                        "type": "number",
                        "description": "Blur radius. 0 = no blur. 5 = subtle. 10 = medium. 20+ = heavy. Default 5."
                    }
                },
                "required": []
            }
        },
        # ── Sharpen ──
        {
            "name": "sharpen",
            "description": "Sharpen the video. Use for 'sharpen', 'make clearer', 'more detail'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "amount": {
                        "type": "number",
                        "description": "Sharpen intensity. 1 = subtle, 2 = normal, 5 = heavy. Default 1.5."
                    }
                },
                "required": []
            }
        },
        # ── Sepia ──
        {
            "name": "sepia",
            "description": "Apply sepia tone (vintage/old photo look). Use for 'sepia', 'vintage', 'old film'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "value": {
                        "type": "number",
                        "description": "Sepia amount as percentage. 100 = full sepia. 50 = partial. 0 = none."
                    }
                },
                "required": []
            }
        },
        # ── Vignette ──
        {
            "name": "vignette",
            "description": "Apply vignette effect (darkened edges). Use for 'vignette', 'darken edges', 'cinematic look'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "intensity": {
                        "type": "number",
                        "description": "Vignette intensity. 0 = none. 0.3 = subtle. 0.5 = normal. 1.0 = heavy. Default 0.5."
                    }
                },
                "required": []
            }
        },
        # ── Fade In ──
        {
            "name": "fade_in",
            "description": "Add a fade-in from black at the start of the clip.",
            "parameters": {
                "type": "object",
                "properties": {
                    "duration": {
                        "type": "number",
                        "description": "Fade duration in seconds. Default 1.0."
                    }
                },
                "required": []
            }
        },
        # ── Fade Out ──
        {
            "name": "fade_out",
            "description": "Add a fade-out to black at the end of the clip.",
            "parameters": {
                "type": "object",
                "properties": {
                    "start": {
                        "type": "number",
                        "description": "Start time for fade in seconds from clip start. If omitted, calculated from clip end."
                    },
                    "duration": {
                        "type": "number",
                        "description": "Fade duration in seconds. Default 1.0."
                    }
                },
                "required": []
            }
        },
        # ── Cross Dissolve ──
        {
            "name": "cross_dissolve",
            "description": "Add a cross dissolve transition between clips.",
            "parameters": {
                "type": "object",
                "properties": {
                    "duration": {
                        "type": "number",
                        "description": "Dissolve duration in seconds. Default 1.0."
                    }
                },
                "required": []
            }
        },
        # ── Speed ──
        {
            "name": "set_speed",
            "description": "Change playback speed. Use for 'speed up', 'slow down', 'slow motion', 'timelapse'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "rate": {
                        "type": "number",
                        "description": "Speed multiplier. 1.0 = normal. 2.0 = 2x faster. 0.5 = half speed (slow motion). 0.25 = quarter speed."
                    }
                },
                "required": ["rate"]
            }
        },
        # ── Volume ──
        {
            "name": "set_volume",
            "description": "Adjust audio volume. Use for 'louder', 'quieter', 'mute', 'volume'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "value": {
                        "type": "number",
                        "description": "Volume as percentage. 100 = normal. 0 = muted. 200 = double. For 'louder' use 130, 'quieter' use 70."
                    }
                },
                "required": ["value"]
            }
        },
        # ── Generic Effect Application ──
        {
            "name": "apply_effect",
            "description": "Apply any effect from the effect registry by its ID. Use when a specific effect function isn't available.",
            "parameters": {
                "type": "object",
                "properties": {
                    "effect_id": {
                        "type": "string",
                        "enum": DESKTOP_EFFECTS,
                        "description": "Effect ID from the ChatCut registry."
                    },
                    "value": {
                        "type": "number",
                        "description": "Primary parameter value for the effect."
                    }
                },
                "required": ["effect_id"]
            }
        },
        # ── Clip Operations ──
        {
            "name": "cut",
            "description": "Split/cut a clip at the current playhead position.",
            "parameters": {
                "type": "object",
                "properties": {
                    "time": {
                        "type": "number",
                        "description": "Time in seconds where to cut. Uses playhead position if omitted."
                    }
                },
                "required": []
            }
        },
        {
            "name": "trim",
            "description": "Trim a clip's start or end.",
            "parameters": {
                "type": "object",
                "properties": {
                    "start": {
                        "type": "number",
                        "description": "New start time in seconds."
                    },
                    "end": {
                        "type": "number",
                        "description": "New end time in seconds."
                    }
                },
                "required": []
            }
        },
        {
            "name": "delete",
            "description": "Delete/remove the selected clip.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        },
        # ── Reset ──
        {
            "name": "reset",
            "description": "Reset all transforms and effects to default values.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        },
        # ── Clarification ──
        {
            "name": "askClarification",
            "description": "Ask the user for clarification when the request is ambiguous, or respond to greetings/chat.",
            "parameters": {
                "type": "object",
                "properties": {
                    "message": {
                        "type": "string",
                        "description": "Message to the user."
                    },
                    "suggestions": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional suggested actions."
                    }
                },
                "required": ["message"]
            }
        }
    ]


# System prompt for desktop mode
DESKTOP_FUNCTION_CALLING_SYSTEM_PROMPT = """You are ChatCut, an AI video editing assistant for the ChatCut desktop editor.

When the user describes an edit, call the appropriate function with correct parameters.

Key defaults (use these when user doesn't specify):
- zoom in without number: scale_percent=150
- zoom out without number: scale_percent=100
- blur without number: amount=5
- "louder"/"increase volume" without number: value=130
- "quieter"/"decrease volume" without number: value=70
- sharpen without number: amount=1.5
- vignette without number: intensity=0.5
- fade in/out without number: duration=1.0
- sepia without number: value=100
- grayscale without number: value=100

Rules:
- Only include optional parameters when explicitly mentioned by user
- For animated=true, only set if user says "gradual", "slow", "smooth", "over time"
- Use askClarification for greetings, ambiguous requests, or questions
- Percentage values: 100 = normal/default, higher = more, lower = less
- For color temperature: lower Kelvin = warmer, higher = cooler
"""
