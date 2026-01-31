"""
Function Calling Schemas for Gemini API

This module defines structured function declarations that replace
the 600+ line system prompt. Each action maps 1:1 to the frontend's
actionDispatcher.js registry.
"""

# Available video filters (matchName values from Premiere Pro)
VIDEO_FILTERS = [
    "PR.ADBE Color Replace",
    "PR.ADBE Gamma Correction",
    "PR.ADBE Extract",
    "PR.ADBE Color Pass",
    "PR.ADBE Lens Distortion",
    "PR.ADBE Levels",
    "AE.ADBE AEASCCDL",
    "AE.ADBE Alpha Adjust",
    "AE.ADBE Alpha Glow",
    "AE.ADBE AEFilterAutoFramer",
    "AE.ADBE Brightness & Contrast 2",
    "AE.ADBE Basic 3D",
    "AE.ADBE Black & White",
    "AE.ADBE Block Dissolve",
    "AE.ADBE Brush Strokes",
    "AE.ADBE Camera Blur",
    "AE.ADBE Cineon Converter",
    "AE.ADBE Color Emboss",
    "AE.ADBE Color Key",
    "AE.ADBE 4ColorGradient",
    "AE.ADBE Corner Pin",
    "AE.ADBE AECrop",
    "AE.ADBE DigitalVideoLimiter",
    "AE.ADBE Motion Blur",
    "AE.ADBE Drop Shadow",
    "AE.ADBE Echo",
    "AE.ADBE Edge Feather",
    "AE.ADBE Reduce Interlace Flicker",
    "AE.ADBE Find Edges",
    "AE.ADBE Gaussian Blur 2",
    "AE.ADBE Gradient Wipe",
    "AE.ADBE Horizontal Flip",
    "AE.ADBE Invert",
    "AE.ADBE Lens Flare",
    "AE.ADBE LightingEffect",
    "AE.ADBE Lightning",
    "AE.ADBE Linear Wipe",
    "AE.ADBE Legacy Key Luma",
    "AE.ADBE Lumetri",
    "AE.ADBE Magnify",
    "AE.ADBE PPro Metadata",
    "AE.ADBE Mirror",
    "AE.ADBE Mosaic",
    "AE.ADBE Noise2",
    "AE.ADBE Offset",
    "AE.ADBE Posterize",
    "AE.ADBE Posterize Time",
    "AE.ADBE ProcAmp",
    "AE.ADBE Ramp",
    "AE.ADBE Replicate",
    "AE.ADBE Rolling Shutter",
    "AE.ADBE Roughen Edges",
    "AE.ADBE AESDRConform",
    "AE.ADBE Sharpen",
    "AE.ADBE PPro SimpleText",
    "AE.ADBE Spherize",
    "AE.ADBE SubspaceStabilizer",
    "AE.ADBE Strobe",
    "AE.ADBE Tint",
    "AE.ADBE Legacy Key Track Matte",
    "AE.ADBE Geometry2",
    "AE.ADBE Turbulent Displace",
    "AE.ADBE Twirl",
    "AE.ADBE Ultra Key",
    "AE.ADBE Unsharp Mask",
    "AE.Mettle SkyBox Chromatic Aberrations",
    "AE.Mettle SkyBox Color Gradients",
    "AE.Mettle SkyBox Denoise",
    "AE.Mettle SkyBox Digital Glitch",
    "AE.Mettle SkyBox Fractal Noise",
    "AE.Mettle SkyBox Blur",
    "AE.Mettle SkyBox Glow",
    "AE.Mettle SkyBox Project 2D",
    "AE.ADBE VR Projection",
    "AE.Mettle SkyBox Rotate Sphere",
    "AE.Mettle SkyBox Sharpen",
    "AE.ADBE Vertical Flip",
    "AE.ADBE Wave Warp",
    "AE.Impact_Alpha_FX",
    "AE.Impact_Auto_Align_FX",
    "AE.Impact_Blur_FX",
    "AE.Impact_Bokeh_Blur_FX",
    "AE.Impact_Camera_Shake_FX",
    "AE.Impact_Channel_Mix_FX",
    "AE.Impact_Clone_FX",
    "AE.Impact_Compound_Blur_FX",
    "AE.Impact_Crop_FX",
    "AE.Impact_Echo_Glow_FX",
    "AE.Impact_Edge_Glow_FX",
    "AE.Impact_Focus_Blur_FX",
    "AE.Impact_Glint_FX",
    "AE.Impact_Grow_FX",
    "AE.Impact_Light_Leaks_FX",
    "AE.Impact_Long_Shadow_FX",
    "AE.Impact_Mosaic_FX",
    "AE.Impact_Move_FX",
    "AE.Impact_RGB_Split_FX",
    "AE.Impact_Rotate_FX",
    "AE.Impact_Shrink_FX",
    "AE.Impact_Spacer_FX",
    "AE.Impact_Spin_FX",
    "AE.Impact_Stroke_FX",
    "AE.Impact_Vignette_FX",
    "AE.Impact_Volumetric_Rays_FX",
    "AE.Impact_Wiggle_FX",
    "AE.Impact_Wonder_Glow_FX"
]

# Available transitions (matchName values from Premiere Pro)
VIDEO_TRANSITIONS = [
    "ADBE Additive Dissolve",
    "ADBE Cross Zoom",
    "ADBE Cube Spin",
    "ADBE Film Dissolve",
    "ADBE Flip Over",
    "ADBE Gradient Wipe",
    "ADBE Iris Cross",
    "ADBE Iris Diamond",
    "ADBE Iris Round",
    "ADBE Iris Square",
    "ADBE Page Turn",
    "ADBE Push",
    "ADBE Slide",
    "ADBE Wipe",
    "AE.ADBE Barn Doors",
    "AE.ADBE Center Split",
    "AE.ADBE Clock Wipe",
    "AE.ADBE Cross Dissolve New",
    "AE.ADBE Dip To Black",
    "AE.ADBE Dip To White",
    "AE.ADBE Inset",
    "AE.ADBE MorphCut",
    "AE.ADBE Non-Additive Dissolve",
    "AE.ADBE Page Peel",
    "AE.ADBE Radial Wipe",
    "AE.ADBE Split",
    "AE.Mettle SkyBox Chroma Leaks",
    "AE.Mettle SkyBox Gradient Wipe",
    "AE.Mettle SkyBox Iris Wipe",
    "AE.Mettle SkyBox Light Leaks",
    "AE.Mettle SkyBox Rays",
    "AE.Mettle SkyBox Mobius Zoom",
    "AE.Mettle SkyBox Random Blocks",
    "AE.Mettle SkyBox Radial Blur",
    "AE.ADBE Whip",
    "AE.AE_Impact_3D_Blinds",
    "AE.AE_Impact_3D_Block",
    "AE.AE_Impact_3D_Flip",
    "AE.AE_Impact_3D_Roll",
    "AE.AE_Impact_3D_Rotate",
    "AE.AE_Impact_Blur_dissolve",
    "AE.AE_Impact_Blur_To_Color",
    "AE.AE_Impact_Burn_Alpha",
    "AE.AE_Impact_Burn_White",
    "AE.AE_Impact_C-Push",
    "AE.AE_Impact_Chaos",
    "AE.AE_Impact_Chroma_Leaks",
    "AE.AE_Impact_Clock_Wipe",
    "AE.AE_Impact_Directional_Blur",
    "AE.AE_Impact_Dissolve",
    "AE.AE_Impact_Earthquake",
    "AE.AE_Impact_Film_Roll",
    "AE.AE_Impact_Flare",
    "AE.AE_Impact_Flash",
    "AE.AE_Impact_Flicker",
    "AE.AE_Impact_Fold",
    "AE.AE_Impact_Frame",
    "AE.AE_Impact_Glass",
    "AE.AE_Impact_Glitch",
    "AE.AE_Impact_Glow",
    "AE.AE_Impact_Grunge",
    "AE.AE_Impact_Kaleido",
    "AE.AE_Impact_Lens_Blur",
    "AE.AE_Impact_Light_Leaks",
    "AE.AE_Impact_Light_Sweep",
    "AE.AE_Impact_Linear_Wipe",
    "AE.AE_Impact_Liquid_Distortion",
    "AE.AE_Impact_Luma_Fade",
    "AE.AE_Impact_Mirror",
    "AE.AE_Impact_Mosaic",
    "AE.AE_Impact_Warp",
    "AE.AE_Impact_Animate",
    "AE.AE_Impact_Copy_Machine",
    "AE.AE_Impact_Page_Peel",
    "AE.AE_Impact_PanelWipe",
    "AE.AE_Impact_Phosphore",
    "AE.AE_Impact_Plateau_Wipe",
    "AE.AE_Impact_Pop",
    "AE.AE_Impact_Pull",
    "AE.AE_Impact_Push",
    "AE.AE_Impact_Radial_Blur",
    "AE.AE_Impact_Rays",
    "AE.AE_Impact_Roll",
    "AE.AE_Impact_Shape_Flow",
    "AE.AE_Impact_Slice",
    "AE.AE_Impact_Solarize",
    "AE.AE_Impact_Spin",
    "AE.AE_Impact_Split",
    "AE.AE_Impact_Spring",
    "AE.AE_Impact_Star_Wipe",
    "AE.AE_Impact_Stretch_Wipe",
    "AE.AE_Impact_Stretch",
    "AE.AE_Impact_Stripes",
    "AE.AE_Impact_TV_Power",
    "AE.AE_Impact_Text_Animator",
    "AE.AE_Impact_Typewriter",
    "AE.AE_Impact_VHS_Damage",
    "AE.AE_Impact_Wave",
    "AE.AE_Impact_Wipe",
    "AE.AE_Impact_Zoom_Blur"
]


def get_function_declarations():
    """
    Returns Gemini function declarations for all available actions.
    These replace the 600+ line system prompt with structured schemas.
    """
    return [
        {
            "name": "zoomIn",
            "description": "Zoom in on video clip. Use for requests like 'zoom in', 'punch in', 'dolly in', 'scale up', 'ken burns effect'. Default endScale is 150 if not specified.",
            "parameters": {
                "type": "object",
                "properties": {
                    "endScale": {
                        "type": "number",
                        "description": "Target zoom percentage (e.g., 120 means 120%, 200 means 2x zoom). Default 150 if not specified."
                    },
                    "startScale": {
                        "type": "number",
                        "description": "Starting zoom percentage. Only include if user explicitly says 'from X to Y'. Default is 100."
                    },
                    "animated": {
                        "type": "boolean",
                        "description": "True for gradual/animated zoom over time (ken burns, slow zoom). False for instant/static zoom that stays constant throughout clip. Default false for simple 'zoom in X%', true if user says 'gradual', 'slow', 'smooth', 'over time', 'from X to Y'."
                    },
                    "duration": {
                        "type": "number",
                        "description": "Animation duration in seconds. Only include if user specifies time like 'over 2 seconds' or 'for 3s'. Omit to use full clip duration."
                    },
                    "startTime": {
                        "type": "number",
                        "description": "Start time offset in seconds from clip start. Only include if user says 'starting at X seconds'."
                    },
                    "interpolation": {
                        "type": "string",
                        "enum": ["LINEAR", "BEZIER", "HOLD", "EASE_IN", "EASE_OUT"],
                        "description": "Animation curve. BEZIER for smooth (default), LINEAR for constant speed, EASE_IN for slow start, EASE_OUT for slow end."
                    }
                },
                "required": []
            }
        },
        {
            "name": "zoomOut",
            "description": "Zoom out on video clip. Use for 'zoom out', 'pull out', 'dolly out', 'scale down'. Default endScale is 100 (original size) if not specified.",
            "parameters": {
                "type": "object",
                "properties": {
                    "endScale": {
                        "type": "number",
                        "description": "Target zoom percentage. Default 100 (original size) if not specified."
                    },
                    "startScale": {
                        "type": "number",
                        "description": "Starting zoom percentage. Only include if user says 'from X to Y'. Default is 150."
                    },
                    "animated": {
                        "type": "boolean",
                        "description": "True for gradual zoom, false for instant/static. Default false unless user implies motion."
                    },
                    "duration": {
                        "type": "number",
                        "description": "Animation duration in seconds. Only if user specifies."
                    },
                    "startTime": {
                        "type": "number",
                        "description": "Start time offset in seconds."
                    },
                    "interpolation": {
                        "type": "string",
                        "enum": ["LINEAR", "BEZIER", "HOLD", "EASE_IN", "EASE_OUT"],
                        "description": "Animation curve type."
                    }
                },
                "required": []
            }
        },
        {
            "name": "applyFilter",
            "description": "Apply a video filter/effect to the clip. Use the exact filterName from the allowed list. Common filters: 'AE.ADBE Black & White' for black and white, 'AE.Impact_Vignette_FX' for vignette, 'AE.ADBE Tint' for color tint.",
            "parameters": {
                "type": "object",
                "properties": {
                    "filterName": {
                        "type": "string",
                        "enum": VIDEO_FILTERS,
                        "description": "Exact filter match name from Premiere Pro"
                    }
                },
                "required": ["filterName"]
            }
        },
        {
            "name": "applyTransition",
            "description": "Apply a video transition. Common: 'AE.ADBE Cross Dissolve New' for dissolve, 'AE.ADBE Dip To Black' for fade to black, 'AE.ADBE Dip To White' for fade to white.",
            "parameters": {
                "type": "object",
                "properties": {
                    "transitionName": {
                        "type": "string",
                        "enum": VIDEO_TRANSITIONS,
                        "description": "Exact transition match name"
                    },
                    "duration": {
                        "type": "number",
                        "description": "Transition duration in seconds. Default 1.0"
                    },
                    "applyToStart": {
                        "type": "boolean",
                        "description": "True to apply at start of clip, false for end. Default true."
                    }
                },
                "required": ["transitionName"]
            }
        },
        {
            "name": "applyBlur",
            "description": "Apply Gaussian blur to the clip. Use this instead of applyFilter for blur requests. Amount: 20-30 for subtle, 50 for normal (default), 80-100 for heavy, 150+ for extreme.",
            "parameters": {
                "type": "object",
                "properties": {
                    "blurAmount": {
                        "type": "integer",
                        "description": "Blur intensity 0-500. Default 50 if not specified. 'slight blur'=25, 'blur'=50, 'heavy blur'=100, 'extreme'=150+"
                    }
                },
                "required": []
            }
        },
        {
            "name": "adjustVolume",
            "description": "Adjust audio volume in decibels. Positive values make it louder, negative make it quieter. IMPORTANT: If user just says 'louder' or 'increase volume' without a number, use 3. If 'quieter' or 'decrease', use -3. For 'much louder'/'a lot', use 6 or -6.",
            "parameters": {
                "type": "object",
                "properties": {
                    "volumeDb": {
                        "type": "number",
                        "description": "Volume change in decibels. +3 for 'louder', -3 for 'quieter', +6 for 'much louder', -6 for 'much quieter'. Use the user's specified dB value if they provide one."
                    }
                },
                "required": ["volumeDb"]
            }
        },
        {
            "name": "modifyParameter",
            "description": "Modify an effect parameter on a clip after an effect is applied. Use for requests like 'set blur to 100', 'change mosaic blocks to 20', 'animate opacity from 0 to 100'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "parameterName": {
                        "type": "string",
                        "description": "Parameter name like 'Blurriness', 'Horizontal Blocks', 'Vertical Blocks', 'Opacity', 'Scale'"
                    },
                    "value": {
                        "type": "number",
                        "description": "Target value (or end value if animated)"
                    },
                    "startValue": {
                        "type": "number",
                        "description": "Start value for animation. Only if user says 'from X to Y'"
                    },
                    "animated": {
                        "type": "boolean",
                        "description": "True to animate the change over time"
                    },
                    "duration": {
                        "type": "number",
                        "description": "Animation duration in seconds"
                    },
                    "startTime": {
                        "type": "number",
                        "description": "Start time offset in seconds"
                    },
                    "interpolation": {
                        "type": "string",
                        "enum": ["LINEAR", "BEZIER", "HOLD", "EASE_IN", "EASE_OUT"],
                        "description": "Animation curve"
                    },
                    "componentName": {
                        "type": "string",
                        "description": "Effect name containing the parameter, e.g., 'Mosaic', 'Gaussian Blur'"
                    }
                },
                "required": ["parameterName", "value"]
            }
        },
        {
            "name": "getParameters",
            "description": "List all available effect parameters on the selected clip. Use when user asks 'what parameters can I change?', 'show effect settings', 'list parameters'.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        },
        {
            "name": "applyAudioFilter",
            "description": "Apply an audio effect/filter like reverb, EQ, or noise reduction.",
            "parameters": {
                "type": "object",
                "properties": {
                    "filterDisplayName": {
                        "type": "string",
                        "description": "Audio filter name like 'Reverb', 'Parametric EQ', 'DeNoise', 'Dynamics'"
                    }
                },
                "required": ["filterDisplayName"]
            }
        },
        {
            "name": "askClarification",
            "description": "Use when the request is ambiguous and needs clarification, OR when user greets you or makes small talk. Also use when multiple filter/transition options match and you need user to choose.",
            "parameters": {
                "type": "object",
                "properties": {
                    "message": {
                        "type": "string",
                        "description": "Friendly message to user - either a question for clarification, response to greeting, or list of options to choose from"
                    },
                    "suggestions": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional list of suggested options (e.g., filter names that match)"
                    }
                },
                "required": ["message"]
            }
        }
    ]


# Minimal system prompt for function calling mode
FUNCTION_CALLING_SYSTEM_PROMPT = """You are a Premiere Pro video editing assistant. 

When the user describes an edit, call the appropriate function with the correct parameters.

Key defaults (use these when user doesn't specify):
- zoomIn without number: endScale=150, animated=false
- zoomOut without number: endScale=100, animated=false  
- blur without number: blurAmount=50
- "louder"/"increase volume" without number: volumeDb=3
- "quieter"/"decrease volume" without number: volumeDb=-3
- "much louder"/"a lot louder": volumeDb=6
- "much quieter"/"a lot quieter": volumeDb=-6

Rules:
- Only include optional parameters when explicitly mentioned by user
- For animated=true, only set if user says "gradual", "slow", "smooth", "over time", "from X to Y"
- Use askClarification for greetings, ambiguous requests, or when multiple options match
- For blur requests, use applyBlur action (not applyFilter)
"""
