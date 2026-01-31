"""
Test suite for Function Calling implementation.

Run with: python -m pytest tests/test_function_calling.py -v
Or directly: python tests/test_function_calling.py
"""
import os
import sys

# Add parent directory to path for imports
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, backend_dir)

from dotenv import load_dotenv
# Load .env from backend directory
load_dotenv(os.path.join(backend_dir, '.env'))

from services.providers.gemini_provider import GeminiProvider


def test_function_calling():
    """Test various prompts with the function calling implementation."""
    
    provider = GeminiProvider()
    
    if not provider.is_configured():
        print("❌ Gemini API not configured. Please set GEMINI_API_KEY in .env")
        return False
    
    print("=" * 60)
    print("Testing Function Calling Implementation")
    print("=" * 60)
    
    test_cases = [
        # Zoom tests
        {
            "prompt": "zoom in 120%",
            "expected_action": "zoomIn",
            "expected_params": {"endScale": 120}
        },
        {
            "prompt": "zoom in",
            "expected_action": "zoomIn",
            "expected_params": {"endScale": 150}  # default
        },
        {
            "prompt": "slow zoom to 150%",
            "expected_action": "zoomIn",
            "expected_params": {"animated": True}
        },
        
        # Blur tests
        {
            "prompt": "add blur",
            "expected_action": "applyBlur",
            "expected_params": {"blurAmount": 50}  # default
        },
        {
            "prompt": "blur it 80",
            "expected_action": "applyBlur",
            "expected_params": {"blurAmount": 80}
        },
        
        # Volume tests
        {
            "prompt": "make it louder",
            "expected_action": "adjustVolume",
            "expected_params": {"volumeDb": 3}  # default
        },
        {
            "prompt": "increase volume by 6db",
            "expected_action": "adjustVolume",
            "expected_params": {"volumeDb": 6}
        },
        {
            "prompt": "make it quieter",
            "expected_action": "adjustVolume",
            "expected_params": {"volumeDb": -3}  # default negative
        },
        
        # Filter tests
        {
            "prompt": "make it black and white",
            "expected_action": "applyFilter",
            "expected_params": {"filterName": "AE.ADBE Black & White"}
        },
        
        # Transition tests
        {
            "prompt": "add cross dissolve",
            "expected_action": "applyTransition",
            "expected_params": {"transitionName": "AE.ADBE Cross Dissolve New"}
        },
        {
            "prompt": "fade to black",
            "expected_action": "applyTransition",
            "expected_params": {"transitionName": "AE.ADBE Dip To Black"}
        },
        
        # Greeting test (should trigger askClarification)
        {
            "prompt": "hello",
            "expected_action": None,  # Should return failure/clarification
            "expected_params": {}
        },
    ]
    
    passed = 0
    failed = 0
    
    for i, test in enumerate(test_cases):
        prompt = test["prompt"]
        expected_action = test["expected_action"]
        expected_params = test["expected_params"]
        
        print(f"\n--- Test {i+1}: \"{prompt}\" ---")
        
        try:
            result = provider.process_prompt(prompt)
            
            action = result.get("action")
            params = result.get("parameters", {})
            message = result.get("message", "")
            error = result.get("error")
            
            # Handle multi-action responses
            actions = result.get("actions")
            if actions and isinstance(actions, list) and len(actions) > 0:
                action = actions[0].get("action")
                params = actions[0].get("parameters", {})
            
            print(f"  Result: action={action}, params={params}")
            if message:
                print(f"  Message: {message[:80]}...")
            
            # Check action
            if expected_action is None:
                # Expecting clarification/failure
                if error or action is None:
                    print(f"  ✅ PASS: Got expected clarification/failure")
                    passed += 1
                else:
                    print(f"  ❌ FAIL: Expected clarification, got action={action}")
                    failed += 1
                continue
            
            if action != expected_action:
                print(f"  ❌ FAIL: Expected action={expected_action}, got {action}")
                failed += 1
                continue
            
            # Check parameters
            param_ok = True
            for key, expected_val in expected_params.items():
                actual_val = params.get(key)
                
                # Handle numeric comparisons with tolerance
                if isinstance(expected_val, (int, float)) and isinstance(actual_val, (int, float)):
                    if abs(expected_val - actual_val) > 0.1:
                        print(f"  ❌ FAIL: param {key}: expected {expected_val}, got {actual_val}")
                        param_ok = False
                elif expected_val != actual_val:
                    print(f"  ❌ FAIL: param {key}: expected {expected_val}, got {actual_val}")
                    param_ok = False
            
            if param_ok:
                print(f"  ✅ PASS")
                passed += 1
            else:
                failed += 1
                
        except Exception as e:
            print(f"  ❌ FAIL: Exception: {e}")
            failed += 1
    
    print("\n" + "=" * 60)
    print(f"Results: {passed} passed, {failed} failed out of {len(test_cases)}")
    print("=" * 60)
    
    return failed == 0


def test_multi_action():
    """Test multi-action prompts."""
    provider = GeminiProvider()
    
    if not provider.is_configured():
        print("❌ Gemini API not configured")
        return False
    
    print("\n" + "=" * 60)
    print("Testing Multi-Action Prompts")
    print("=" * 60)
    
    prompts = [
        "zoom in 120% and add blur",
        "apply black and white filter and zoom in",
    ]
    
    for prompt in prompts:
        print(f"\n--- Prompt: \"{prompt}\" ---")
        result = provider.process_prompt(prompt)
        
        actions = result.get("actions")
        if actions:
            print(f"  Got {len(actions)} actions:")
            for a in actions:
                print(f"    - {a.get('action')}: {a.get('parameters')}")
        else:
            action = result.get("action")
            print(f"  Single action: {action}")
    
    return True


if __name__ == "__main__":
    print("\n🚀 Running Function Calling Tests\n")
    
    success = test_function_calling()
    test_multi_action()
    
    if success:
        print("\n✅ All critical tests passed!")
    else:
        print("\n⚠️ Some tests failed - check output above")
