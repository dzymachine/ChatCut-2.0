const ppro = require("premierepro");
import { 
  getClipDuration, 
  getClipInPoint, 
  getMotionScaleParam,
  validateClip,
  logClipInfo 
} from './clipUtils.js';

// ============ MATCHNAME CONSTANTS ============
// These are language-independent identifiers that work across all Premiere Pro locales
// Effects
const MATCHNAMES = {
  // Effect matchNames
  GAUSSIAN_BLUR: "AE.ADBE Gaussian Blur 2",
  
  // Parameter matchNames (patterns - actual matchName may include index suffix)
  // These patterns are used to find parameters within effects
  PARAMS: {
    // Gaussian Blur parameters
    BLURRINESS: "ADBE Gaussian Blur 2-0001",
    BLUR_DIMENSIONS: "ADBE Gaussian Blur 2-0002",
    REPEAT_EDGE_PIXELS: "ADBE Gaussian Blur 2-0003",
    
    // Audio parameters (common patterns)
    GAIN: ["Gain", "ADBE Gain", "gain"],  // Multiple possible matchNames
    VOLUME: ["Volume", "ADBE Volume", "Level", "level"],
    
    // Motion parameters
    SCALE: "ADBE Scale",
    POSITION: "ADBE Position",
    ROTATION: "ADBE Rotation",
    ANCHOR_POINT: "ADBE Anchor Point",
    
    // Opacity
    OPACITY: "ADBE Opacity",
  }
};

// Map user-friendly parameter names to matchName patterns for lookup
// This allows the AI to use readable names while we search by matchName
const PARAM_NAME_TO_MATCHNAME = {
  // Blur
  "blurriness": MATCHNAMES.PARAMS.BLURRINESS,
  "blur": MATCHNAMES.PARAMS.BLURRINESS,
  "blur amount": MATCHNAMES.PARAMS.BLURRINESS,
  "blur dimensions": MATCHNAMES.PARAMS.BLUR_DIMENSIONS,
  
  // Motion
  "scale": MATCHNAMES.PARAMS.SCALE,
  "position": MATCHNAMES.PARAMS.POSITION,
  "rotation": MATCHNAMES.PARAMS.ROTATION,
  "anchor point": MATCHNAMES.PARAMS.ANCHOR_POINT,
  "anchor": MATCHNAMES.PARAMS.ANCHOR_POINT,
  
  // Opacity
  "opacity": MATCHNAMES.PARAMS.OPACITY,
  
  // Audio
  "gain": MATCHNAMES.PARAMS.GAIN,
  "volume": MATCHNAMES.PARAMS.VOLUME,
  "level": MATCHNAMES.PARAMS.VOLUME,
};

// ============ UTILITY ============
function log(msg, color = "white") {
  console.log(`[Edit][${color}] ${msg}`);
}

/**
 * Find a parameter by matchName pattern
 * @param {Component} component - The component to search in
 * @param {string|string[]} matchNamePattern - The matchName or array of possible matchNames to find
 * @returns {Promise<ComponentParam|null>}
 */
async function findParamByMatchName(component, matchNamePattern) {
  const patterns = Array.isArray(matchNamePattern) ? matchNamePattern : [matchNamePattern];
  const paramCount = await component.getParamCount();
  
  for (let pi = 0; pi < paramCount; pi++) {
    try {
      const param = await component.getParam(pi);
      const matchName = await param.getMatchName();
      
      // Check if matchName matches any of the patterns (exact or contains)
      for (const pattern of patterns) {
        if (matchName === pattern || matchName.toLowerCase().includes(pattern.toLowerCase())) {
          log(`Found param by matchName: ${matchName}`, "green");
          return param;
        }
      }
    } catch (err) {
      // Continue searching
    }
  }
  return null;
}

/**
 * Find a parameter across all components by matchName pattern
 * @param {ComponentChain} componentChain - The component chain to search
 * @param {string|string[]} matchNamePattern - The matchName or array of possible matchNames
 * @returns {Promise<ComponentParam|null>}
 */
async function findParamInChainByMatchName(componentChain, matchNamePattern) {
  const compCount = await componentChain.getComponentCount();
  
  for (let ci = 0; ci < compCount; ci++) {
    try {
      const comp = await componentChain.getComponentAtIndex(ci);
      const param = await findParamByMatchName(comp, matchNamePattern);
      if (param) return param;
    } catch (err) {
      // Continue searching
    }
  }
  return null;
}

async function executeAction(project, action) {
  return new Promise((resolve, reject) => {
    try {
      project.lockedAccess(() => {
        project.executeTransaction((compound) => {
          compound.addAction(action);
        });
        resolve();
      });
    } catch (err) {
      log(`Error executing action: ${err}`, "red");
      reject(err);
    }
  });
}

// ============ LUMETRI BY INDEX ============
const LUMETRI_MATCHNAME = "AE.ADBE Lumetri";
const LUMETRI_PARAM_INDEX = {
  exposure: 19,
  contrast: 20,
  highlights: 21,
  shadows: 22,
  whites: 23,
  blacks: 24,
  temperature: 14,
  tint: 15,
  saturation: 16,
  vibrance: 42
};

async function getLumetriComponent(trackItem, project, addIfMissing = true) {
  const componentChain = await trackItem.getComponentChain();
  if (!componentChain) {
    log("[LUMETRI] No component chain", "red");
    return null;
  }

  let lumetriComp = null;
  let compCount = await componentChain.getComponentCount();

  for (let ci = 0; ci < compCount; ci++) {
    const comp = await componentChain.getComponentAtIndex(ci);
    const matchName = await comp.getMatchName();
    if (matchName === LUMETRI_MATCHNAME) {
      lumetriComp = comp;
      break;
    }
  }

  if (!lumetriComp && addIfMissing) {
    log("[LUMETRI] Lumetri not found. Adding it...", "yellow");
    try {
      const lumetriComponent = await ppro.VideoFilterFactory.createComponent(LUMETRI_MATCHNAME);
      const appendAction = await componentChain.createAppendComponentAction(lumetriComponent);
      await executeAction(project, appendAction);

      compCount = await componentChain.getComponentCount();
      for (let ci = 0; ci < compCount; ci++) {
        const comp = await componentChain.getComponentAtIndex(ci);
        const matchName = await comp.getMatchName();
        if (matchName === LUMETRI_MATCHNAME) {
          lumetriComp = comp;
          break;
        }
      }
    } catch (err) {
      log(`[LUMETRI] Failed to add Lumetri: ${err.message || err}`, "red");
      return null;
    }
  }

  return lumetriComp;
}

async function setLumetriParamByIndex(lumetriComp, project, paramIndex, value) {
  const paramCount = await lumetriComp.getParamCount();
  if (paramIndex >= paramCount) {
    log(`[LUMETRI] Parameter index ${paramIndex} out of range (max: ${paramCount - 1})`, "red");
    return false;
  }

  const param = await lumetriComp.getParam(paramIndex);
  const displayName = param.displayName || "(no name)";
  const keyframe = await param.createKeyframe(Number(value));
  const setAction = await param.createSetValueAction(keyframe, true);
  await executeAction(project, setAction);

  log(`[LUMETRI] Set ${displayName} (index ${paramIndex}) to ${value}`, "green");
  return true;
}

async function getLumetriParamValue(param) {
  try {
    let raw = null;

    if (typeof param.getValueAtTime === "function") {
      try {
        const time = ppro.TickTime.createWithSeconds(0);
        raw = await param.getValueAtTime(time);
      } catch (err) {
        raw = null;
      }
    }

    if (raw === null || raw === undefined) {
      raw = await param.getValue();
    }

    if (raw && typeof raw.getValue === "function") {
      return await raw.getValue();
    }

    if (raw && typeof raw.value === "number") {
      return raw.value;
    }

    if (typeof raw === "number") {
      return raw;
    }
  } catch (err) {
    // Ignore and fall through
  }

  return null;
}

/**
 * Adjust Lumetri parameters by index mapping.
 * Values are raw Lumetri values (no min/max exposed by the API).
 * @param {TrackItem} trackItem - The clip to modify
 * @param {Object} options - Color adjustment options
 * @param {number} options.exposure - Exposure value
 * @param {number} options.contrast - Contrast value
 * @param {number} options.highlights - Highlights value
 * @param {number} options.shadows - Shadows value
 * @param {number} options.whites - Whites value
 * @param {number} options.blacks - Blacks value
 * @param {number} options.temperature - Temperature value
 * @param {number} options.tint - Tint value
 * @param {number} options.saturation - Saturation value
 * @param {number} options.vibrance - Vibrance value
 * @param {boolean} options.addIfMissing - Add Lumetri if missing (default: true)
 * @param {boolean} options.relative - Treat values as deltas added to current values (default: false)
 * @returns {Promise<{successful: number, failed: number}>}
 */
export async function adjustColor(trackItem, options = {}) {
  const {
    addIfMissing = true,
    relative = false,
    exposure,
    contrast,
    highlights,
    shadows,
    whites,
    blacks,
    temperature,
    tint,
    saturation,
    vibrance
  } = options;

  if (!trackItem) {
    log("[LUMETRI] No track item provided", "red");
    return { successful: 0, failed: 0 };
  }

  const project = await ppro.Project.getActiveProject();
  if (!project) {
    log("[LUMETRI] No active project", "red");
    return { successful: 0, failed: 0 };
  }

  const lumetriComp = await getLumetriComponent(trackItem, project, addIfMissing);
  if (!lumetriComp) {
    log("[LUMETRI] Lumetri not found or could not be added", "red");
    return { successful: 0, failed: 0 };
  }

  const updates = {
    exposure,
    contrast,
    highlights,
    shadows,
    whites,
    blacks,
    temperature,
    tint,
    saturation,
    vibrance
  };

  const entries = Object.entries(updates).filter(([, value]) => value !== undefined && value !== null);
  if (entries.length === 0) {
    log("[LUMETRI] No values provided", "yellow");
    return { successful: 0, failed: 0 };
  }

  let successful = 0;
  let failed = 0;

  for (const [name, value] of entries) {
    const paramIndex = LUMETRI_PARAM_INDEX[name];
    if (paramIndex === undefined) {
      failed += 1;
      continue;
    }

    try {
      let newValue = value;

      if (relative) {
        const param = await lumetriComp.getParam(paramIndex);
        const currentValue = await getLumetriParamValue(param);
        if (typeof currentValue === "number") {
          newValue = currentValue + Number(value);
        }
      }

      const result = await setLumetriParamByIndex(lumetriComp, project, paramIndex, newValue);
      if (result) successful += 1;
      else failed += 1;
    } catch (err) {
      log(`[LUMETRI] Failed to set ${name}: ${err.message || err}`, "red");
      failed += 1;
    }
  }

  return { successful, failed };
}

// ============ KEYFRAME HELPERS ============

/**
 * Create a keyframe at a specific time with interpolation
 * @param {ComponentParam} param - The parameter to add keyframe to
 * @param {Project} project - Premiere Pro project
 * @param {number} seconds - Time in seconds
 * @param {number} value - Keyframe value
 * @param {string} interpolation - 'LINEAR', 'BEZIER', 'HOLD', 'EASE_IN', 'EASE_OUT'
 * @returns {Promise<boolean>}
 */
async function addKeyframe(param, project, seconds, value, interpolation = 'BEZIER') {
  try {
    log(`Creating keyframe at ${seconds.toFixed(2)}s with value ${value}`, "blue");

    // Enable time-varying if not already enabled
    await project.lockedAccess(async () => {
      project.executeTransaction((compound) => {
        const action = param.createSetTimeVaryingAction(true);
        compound.addAction(action);
      });
    });
    log(`✓ Time-varying enabled`, "green");

    // Add the keyframe
    await project.lockedAccess(async () => {
      project.executeTransaction((compound) => {
        const keyframe = param.createKeyframe(value);
        keyframe.position = ppro.TickTime.createWithSeconds(seconds);
        const action = param.createAddKeyframeAction(keyframe);
        compound.addAction(action);
      });
    });
    log(`✓ Keyframe added at ${seconds.toFixed(2)}s`, "green");

    // Set interpolation mode
    const modeMap = {
      'LINEAR': ppro.Constants.InterpolationMode.LINEAR,
      'BEZIER': ppro.Constants.InterpolationMode.BEZIER,
      'HOLD': ppro.Constants.InterpolationMode.HOLD,
      'EASE_IN': ppro.Constants.InterpolationMode.EASE_IN,
      'EASE_OUT': ppro.Constants.InterpolationMode.EASE_OUT,
    };
    const interpMode = modeMap[interpolation] || ppro.Constants.InterpolationMode.BEZIER;

    await project.lockedAccess(async () => {
      project.executeTransaction((compound) => {
        const action = param.createSetInterpolationAtKeyframeAction(
          ppro.TickTime.createWithSeconds(seconds),
          interpMode
        );
        compound.addAction(action);
      });
    });
    log(`✓ Interpolation set to ${interpolation}`, "green");

    log(`✅ Keyframe successfully created at ${seconds.toFixed(2)}s: value=${value}`, "green");
    return true;
  } catch (err) {
    log(`❌ Error adding keyframe: ${err.message || err}`, "red");
    console.error("Keyframe creation error details:", err);
    return false;
  }
}

// ============ ZOOM FUNCTIONS ============

/**
 * Zoom in on a clip - creates animation from start scale to end scale (or static zoom)
 * @param {TrackItem} trackItem - The clip to zoom
 * @param {Object} options - Zoom options
 * @param {number} options.startScale - Starting scale percentage (default: 100)
 * @param {number} options.endScale - Ending scale percentage (default: 150)
 * @param {number} options.startTime - Start time in seconds relative to clip (default: 0)
 * @param {number} options.duration - Duration of zoom in seconds (default: entire clip)
 * @param {string} options.interpolation - 'LINEAR', 'BEZIER', 'HOLD', 'EASE_IN', 'EASE_OUT' (default: 'BEZIER')
 * @param {boolean} options.animated - If true, creates gradual zoom (100%→150%). If false, creates static zoom (150%→150%) (default: true)
 * @returns {Promise<boolean>}
 */
export async function zoomIn(trackItem, options = {}) {
  let {
    startScale,
    endScale = 150,
    startTime = 0,
    duration = null,
    interpolation = 'BEZIER',
    animated = false  // Default to static zoom (unless user explicitly asks for gradual)
  } = options;
  
  const actualEndScale = endScale;

  try {
    log(`Starting zoomIn function...`, "blue");
    
    // Validate clip
    const validation = await validateClip(trackItem);
    if (!validation.valid) {
      log(`❌ Cannot zoom: ${validation.reason}`, "red");
      return false;
    }
    log(`✓ Clip validation passed`, "green");

    // Get project
    const project = await ppro.Project.getActiveProject();
    if (!project) {
      log("❌ No active project", "red");
      return false;
    }
    log(`✓ Project found`, "green");

    // Get Motion Scale parameter
    log(`Looking for Motion Scale parameter...`, "blue");
    const context = await getMotionScaleParam(trackItem, project);
    if (!context) {
      log("❌ Could not get Motion Scale parameter", "red");
      return false;
    }
    log(`✓ Motion Scale parameter found`, "green");

    const { componentParam } = context;

    // Calculate timing
    const clipDuration = await getClipDuration(trackItem);
    const clipStartTime = await getClipInPoint(trackItem);
    
    if (clipDuration === null || clipStartTime === null) {
      log(`❌ Could not get clip timing information`, "red");
      return false;
    }
    
    const zoomDuration = duration || clipDuration;
    const absoluteStartTime = clipStartTime + startTime;
    const absoluteEndTime = absoluteStartTime + zoomDuration;

    // Resolve startScale if not provided
    if (startScale === undefined) {
      if (startTime > 0) {
        // If starting mid-clip, try to get the current value at that time
        // This enables smooth chaining (e.g. zoom in then out)
        try {
          const val = await componentParam.getValueAtTime(
            ppro.TickTime.createWithSeconds(absoluteStartTime)
          );
          const currentVal = (val && typeof val.getValue === 'function') 
            ? await val.getValue() 
            : Number(val);
            
          startScale = currentVal;
          log(`Dynamically determined startScale at ${startTime}s: ${startScale}`, "blue");
        } catch (e) {
          log(`Could not get current scale, defaulting to 100: ${e}`, "yellow");
          startScale = 100;
        }
      } else {
        // Default to 100 if starting at beginning
        startScale = 100;
      }
    }

    // For static zoom, use the endScale for both start and end
    const actualStartScale = animated ? startScale : endScale;

    // Log different messages for animated vs static zoom
    if (animated) {
      log(`Applying gradual zoom: ${actualStartScale}% → ${actualEndScale}% over ${zoomDuration.toFixed(2)}s`, "blue");
    } else {
      log(`Applying static zoom: ${actualEndScale}% throughout entire clip`, "blue");
    }
    log(`Clip starts at: ${clipStartTime.toFixed(2)}s, duration: ${clipDuration.toFixed(2)}s`, "blue");
    log(`Keyframes at: ${absoluteStartTime.toFixed(2)}s and ${absoluteEndTime.toFixed(2)}s`, "blue");
    await logClipInfo(trackItem);

    // Create start keyframe
    log(`Creating start keyframe at ${absoluteStartTime.toFixed(2)}s with value ${actualStartScale}`, "blue");
    const startSuccess = await addKeyframe(
      componentParam, 
      project, 
      absoluteStartTime, 
      actualStartScale, 
      interpolation
    );

    if (!startSuccess) {
      log("❌ Failed to create start keyframe", "red");
      return false;
    }

    // Create end keyframe
    log(`Creating end keyframe at ${absoluteEndTime.toFixed(2)}s with value ${actualEndScale}`, "blue");
    const endSuccess = await addKeyframe(
      componentParam, 
      project, 
      absoluteEndTime, 
      actualEndScale, 
      interpolation
    );

    if (!endSuccess) {
      log("❌ Failed to create end keyframe", "red");
      return false;
    }

    if (animated) {
      log(`✅ Gradual zoom applied successfully! Scale ${actualStartScale}% → ${actualEndScale}%`, "green");
    } else {
      log(`✅ Static zoom applied successfully! Scale ${actualEndScale}% throughout clip`, "green");
    }
    return true;
  } catch (err) {
    log(`❌ Error in zoomIn: ${err.message || err}`, "red");
    console.error("zoomIn error details:", err);
    return false;
  }
}

/**
 * Zoom out on a clip - creates animation from larger scale to smaller scale
 * @param {TrackItem} trackItem - The clip to zoom
 * @param {Object} options - Zoom options (same as zoomIn)
 * @returns {Promise<boolean>}
 */
export async function zoomOut(trackItem, options = {}) {
  const {
    endScale = 100,
    startScale,
    ...otherOptions
  } = options;

  // If startScale is not provided and it's a simple start-of-clip zoom out, default to 150.
  // Otherwise (mid-clip or chained), leave undefined to let zoomIn resolve it dynamically.
  let effectiveStartScale = startScale;
  if (effectiveStartScale === undefined && (!options.startTime || options.startTime === 0)) {
    effectiveStartScale = 150;
  }

  log("Applying zoom out...", "blue");
  return await zoomIn(trackItem, { startScale: effectiveStartScale, endScale, ...otherOptions });
}

/**
 * Apply zoom in to multiple clips
 * @param {TrackItem[]} trackItems - Array of clips
 * @param {Object} options - Zoom options
 * @returns {Promise<{successful: number, failed: number}>}
 */
export async function zoomInBatch(trackItems, options = {}) {
  log(`Applying zoom in to ${trackItems.length} clip(s)...`, "blue");
  
  let successful = 0;
  let failed = 0;

  for (let i = 0; i < trackItems.length; i++) {
    const clip = trackItems[i];
    log(`Processing clip ${i + 1}/${trackItems.length}...`, "blue");
    
    const result = await zoomIn(clip, options);
    if (result) {
      successful++;
    } else {
      failed++;
    }
  }

  log(`✅ Batch complete: ${successful} successful, ${failed} failed`, "green");
  return { successful, failed };
}

/**
 * Apply zoom out to multiple clips
 * @param {TrackItem[]} trackItems - Array of clips
 * @param {Object} options - Zoom options
 * @returns {Promise<{successful: number, failed: number}>}
 */
export async function zoomOutBatch(trackItems, options = {}) {
  log(`Applying zoom out to ${trackItems.length} clip(s)...`, "blue");
  
  let successful = 0;
  let failed = 0;

  for (let i = 0; i < trackItems.length; i++) {
    const clip = trackItems[i];
    log(`Processing clip ${i + 1}/${trackItems.length}...`, "blue");
    
    const result = await zoomOut(clip, options);
    if (result) {
      successful++;
    } else {
      failed++;
    }
  }

  log(`✅ Batch complete: ${successful} successful, ${failed} failed`, "green");
  return { successful, failed };
}

// ============ BLUR ============
/**
 * Apply blur effect to a single track item
 * @param {TrackItem} trackItem - The clip to apply blur to
 * @param {number} blurriness - Blur amount (default: 50)
 * @returns {Promise<boolean>}
 */
export async function applyBlur(trackItem, blurriness = 50) {
  try {
    const project = await ppro.Project.getActiveProject();
    if (!project) {
      log("No active project", "red");
      return false;
    }

    if (!trackItem) {
      log("No track item provided", "red");
      return false;
    }

    const componentChain = await trackItem.getComponentChain();
    if (!componentChain) {
      log("No component chain", "red");
      return false;
    }

    // Find blur parameter by matchName (language-independent)
    // First, try to find an existing Gaussian Blur effect's Blurriness parameter
    let blurParam = await findParamInChainByMatchName(
      componentChain, 
      MATCHNAMES.PARAMS.BLURRINESS
    );

    // If not found, append Gaussian Blur effect and search again
    if (!blurParam) {
      log(`Adding Gaussian Blur effect: ${MATCHNAMES.GAUSSIAN_BLUR}`, "blue");
      const blurComponent = await ppro.VideoFilterFactory.createComponent(MATCHNAMES.GAUSSIAN_BLUR);
      const appendAction = await componentChain.createAppendComponentAction(blurComponent);
      await executeAction(project, appendAction);
      
      // Search again for the blur parameter
      blurParam = await findParamInChainByMatchName(
        componentChain, 
        MATCHNAMES.PARAMS.BLURRINESS
      );
      
      // Fallback: if matchName search fails, try searching by component matchName pattern
      if (!blurParam) {
        log("Searching for blur param by component pattern...", "blue");
        const compCount = await componentChain.getComponentCount();
        for (let ci = 0; ci < compCount; ci++) {
          const comp = await componentChain.getComponentAtIndex(ci);
          const compMatchName = await comp.getMatchName();
          
          // Look for Gaussian Blur component
          if (compMatchName.includes("Gaussian Blur")) {
            // Get first numeric parameter (typically the blur amount)
            const paramCount = await comp.getParamCount();
            for (let pi = 0; pi < paramCount; pi++) {
              const param = await comp.getParam(pi);
              const paramMatchName = await param.getMatchName();
              log(`  Param ${pi}: ${paramMatchName} (display: ${param.displayName})`, "blue");
              
              // First parameter of Gaussian Blur is typically Blurriness
              if (pi === 0 || paramMatchName.includes("0001")) {
                blurParam = param;
                log(`Found blur param via component search: ${paramMatchName}`, "green");
                break;
              }
            }
            if (blurParam) break;
          }
        }
      }
    }

    if (!blurParam) {
      log("Could not find Blurriness parameter by matchName", "yellow");
      return false;
    }

    // Set value via keyframe (required by createSetValueAction)
    const keyframe = blurParam.createKeyframe(Number(blurriness));
    const setAction = blurParam.createSetValueAction(keyframe, true);
    await executeAction(project, setAction);

    log(`✅ Blur effect (${blurriness}) applied`, "green");
    return true;

  } catch (err) {
    log(`Error applying blur: ${err}`, "red");
    return false;
  }
}

// ============ TRANSITIONS ============
export async function applyTransition(item, transitionName, durationSeconds = 1.0, applyToStart = true, transitionAllignment = 0.5) {
  try {
    const matchNameList = await ppro.TransitionFactory.getVideoTransitionMatchNames();
    console.log("Available transitions:", matchNameList);
    const matched = matchNameList.find(n => n.toLowerCase() === transitionName.toLowerCase());

    if (!matched) {
      log(`Transition not found: ${transitionName}`, "red");
      return false;
    }

    const videoTransition = await ppro.TransitionFactory.createVideoTransition(matched);
    const opts = new ppro.AddTransitionOptions();
    console.log("AddTransitionOptions created:", opts);
    opts.setApplyToStart(applyToStart);
    const time = await ppro.TickTime.createWithSeconds(durationSeconds);
    opts.setDuration(time);
    opts.setForceSingleSided(false);
    opts.setTransitionAlignment(transitionAllignment);

    const project = await ppro.Project.getActiveProject();
    const action = await item.createAddVideoTransitionAction(videoTransition, opts);
    await executeAction(project, action);

    log(`Transition applied: ${matched}`, "green");
    return true;
  } catch (err) {
    log(`Error applying transition: ${err}`, "red");
    return false;
  }
}

// ============ FILTERS/EFFECTS ============
export async function applyRandomFilter(item) {
  try {
    const matchNames = await ppro.VideoFilterFactory.getMatchNames();
    console.log("Available video filters:", matchNames);
    if (!matchNames || matchNames.length === 0) {
      log("No video filters available", "red");
      return false;
    }

    const randomName = matchNames[Math.floor(Math.random() * matchNames.length)];
    const component = await ppro.VideoFilterFactory.createComponent(randomName);
    const componentChain = await item.getComponentChain();
    const project = await ppro.Project.getActiveProject();
    const action = await componentChain.createAppendComponentAction(component);
    await executeAction(project, action);

    log(`Filter applied: ${randomName}`, "green");
    return true;
  } catch (err) {
    log(`Error applying filter: ${err}`, "red");
    return false;
  }
}

export async function applyFilter(item, filterName) {
  try {
    const matchNames = await ppro.VideoFilterFactory.getMatchNames();
    console.log("Available video filters:", matchNames);
    if (!matchNames.includes(filterName)) {
      log(`Filter not found: ${filterName}`, "red");
      return false;
    }
    const component = await ppro.VideoFilterFactory.createComponent(filterName);
    const componentChain = await item.getComponentChain();
    const project = await ppro.Project.getActiveProject();
    const action = await componentChain.createAppendComponentAction(component);
    await executeAction(project, action);
    const compCount = componentChain.getComponentCount();
    console.log("Component count after adding filter:", compCount);
    for (let ci = 0; ci < compCount; ci++) {
      const comp = await componentChain.getComponentAtIndex(ci);
      const name = await comp.getMatchName();
      const dispName = await comp.getDisplayName();
      console.log(`Component ${ci}: ${name} (${dispName})`);
      const paramCount = comp.getParamCount();
      for (let pi = 0; pi < paramCount; pi++) {
        const param = await comp.getParam(pi);
        console.log(" Param details:", param);
        const name = (param && param.displayName ? param.displayName : "").trim().toLowerCase();
        console.log("  Param:", name);
      }
    }

    log(`Filter applied: ${filterName}`, "green");
    return true;
  } catch (err) {
    log(`Error applying filter: ${err}`, "red");
    return false;
  }
}

// ============ AUDIO EFFECTS ============

// Audio filter matchName mappings (language-independent)
// Maps user-friendly terms to possible matchNames
const AUDIO_FILTER_MATCHNAMES = {
  'reverb': ['ADBE Studio Reverb', 'ADBE Convolution Reverb', 'ADBE Surround Reverb', 'AUReverb2', 'AUMatrixReverb'],
  'eq': ['ADBE Parametric EQ', 'ADBE Simple Parametric EQ', 'ADBE Graphic Equalizer 10', 'ADBE Graphic Equalizer 20', 'ADBE Graphic Equalizer 30'],
  'equalizer': ['ADBE Parametric EQ', 'ADBE Simple Parametric EQ', 'ADBE Graphic Equalizer 10'],
  'parametric eq': ['ADBE Parametric EQ', 'ADBE Simple Parametric EQ'],
  'noise reduction': ['ADBE Adaptive Noise Reduction', 'ADBE DeNoise'],
  'denoise': ['ADBE Adaptive Noise Reduction', 'ADBE DeNoise'],
  'deesser': ['ADBE DeEsser'],
  'chorus': ['ADBE Chorus Flanger'],
  'flanger': ['ADBE Chorus Flanger', 'ADBE Flanger'],
  'delay': ['ADBE Delay', 'ADBE Multitap Delay', 'ADBE Analog Delay'],
  'distortion': ['ADBE Distortion'],
  'compressor': ['ADBE Multiband Compressor', 'ADBE Single-band Compressor', 'ADBE Tube-modeled Compressor'],
  'limiter': ['ADBE Hard Limiter'],
  'phaser': ['ADBE Phaser'],
  'pitch': ['ADBE Pitch Shifter', 'AUPitch', 'AUNewPitch'],
  'dynamics': ['ADBE Dynamics'],
  'gain': ['ADBE Channel Volume', 'ADBE Gain'],
  'volume': ['ADBE Channel Volume', 'ADBE Gain'],
};

/**
 * Apply an audio filter/effect to an audio clip
 * @param {AudioClipTrackItem} audioClip - The audio clip to apply effect to
 * @param {string} filterName - Filter name (matchName preferred, displayName as fallback)
 * @returns {Promise<boolean>}
 */
export async function applyAudioFilter(audioClip, filterName) {
  try {
    log(`Applying audio filter: ${filterName}`, "blue");
    
    const project = await ppro.Project.getActiveProject();
    if (!project) {
      log("No active project", "red");
      return false;
    }

    if (!audioClip) {
      log("No audio clip provided", "red");
      return false;
    }

    // Get available audio filter matchNames and displayNames
    let matchNames = [];
    let displayNames = [];
    
    try {
      matchNames = await ppro.AudioFilterFactory.getMatchNames();
      log(`Available audio filter matchNames: ${matchNames.slice(0, 10).join(', ')}...`, "blue");
    } catch (e) {
      log(`getMatchNames not available for audio filters`, "yellow");
    }
    
    displayNames = await ppro.AudioFilterFactory.getDisplayNames();
    console.log("Available audio filters (displayNames):", displayNames);
    
    const normalizedSearch = filterName.toLowerCase().trim();
    let resolvedFilterName = null;
    let useMatchName = false;
    
    // Strategy 1: Direct matchName match (if input looks like a matchName)
    if (matchNames.length > 0 && filterName.includes('ADBE')) {
      const exactMatch = matchNames.find(mn => mn === filterName);
      if (exactMatch) {
        resolvedFilterName = exactMatch;
        useMatchName = true;
        log(`Direct matchName match: ${resolvedFilterName}`, "green");
      }
    }
    
    // Strategy 2: Look up in our matchName mapping
    if (!resolvedFilterName && AUDIO_FILTER_MATCHNAMES[normalizedSearch]) {
      const candidates = AUDIO_FILTER_MATCHNAMES[normalizedSearch];
      for (const candidate of candidates) {
        // Check if this matchName exists
        if (matchNames.length > 0) {
          const found = matchNames.find(mn => 
            mn === candidate || mn.toLowerCase().includes(candidate.toLowerCase())
          );
          if (found) {
            resolvedFilterName = found;
            useMatchName = true;
            log(`Matched "${filterName}" to matchName: ${resolvedFilterName}`, "blue");
            break;
          }
        }
      }
    }
    
    // Strategy 3: Fuzzy matchName search
    if (!resolvedFilterName && matchNames.length > 0) {
      resolvedFilterName = matchNames.find(mn => 
        mn.toLowerCase().includes(normalizedSearch) ||
        normalizedSearch.split(/\s+/).some(word => mn.toLowerCase().includes(word))
      );
      if (resolvedFilterName) {
        useMatchName = true;
        log(`Fuzzy matchName match: ${resolvedFilterName}`, "blue");
      }
    }
    
    // Strategy 4: Fall back to displayName matching (less reliable for non-English)
    if (!resolvedFilterName) {
      log(`No matchName found, falling back to displayName search`, "yellow");
      
      // Try exact displayName match
      resolvedFilterName = displayNames.find(dn => 
        dn.toLowerCase() === normalizedSearch
      );
      
      // Try partial displayName match
      if (!resolvedFilterName) {
        resolvedFilterName = displayNames.find(dn => 
          dn.toLowerCase().includes(normalizedSearch) ||
          normalizedSearch.split(/\s+/).some(word => dn.toLowerCase().includes(word))
        );
      }
    }
    
    if (!resolvedFilterName) {
      log(`Audio filter not found: ${filterName}`, "red");
      log(`Available matchNames: ${matchNames.slice(0, 10).join(', ')}...`, "yellow");
      log(`Available displayNames: ${displayNames.slice(0, 10).join(', ')}...`, "yellow");
      return false;
    }
    
    log(`Resolved "${filterName}" to "${resolvedFilterName}" (matchName: ${useMatchName})`, "blue");

    // Create audio filter component
    let audioFilterComponent;
    if (useMatchName) {
      audioFilterComponent = await ppro.AudioFilterFactory.createComponent(resolvedFilterName);
    } else {
      audioFilterComponent = await ppro.AudioFilterFactory.createComponentByDisplayName(
        resolvedFilterName,
        audioClip
      );
    }

    // Get audio component chain and append the filter
    const audioComponentChain = await audioClip.getComponentChain();
    const action = await audioComponentChain.createAppendComponentAction(audioFilterComponent);
    await executeAction(project, action);

    log(`✅ Audio filter applied: ${resolvedFilterName}`, "green");
    return true;
  } catch (err) {
    log(`Error applying audio filter: ${err}`, "red");
    console.error("applyAudioFilter error details:", err);
    return false;
  }
}

/**
 * Adjust volume of an audio clip
 * @param {AudioClipTrackItem} audioClip - The audio clip to adjust
 * @param {number} volumeDb - Volume adjustment in decibels (positive = louder, negative = quieter)
 * @returns {Promise<boolean>}
 */
export async function adjustVolume(audioClip, volumeDb = 0) {
  try {
    log(`[VOLUME] ========== STARTING VOLUME ADJUSTMENT ==========`, "blue");
    log(`[VOLUME] Input volumeDb parameter: ${volumeDb} (type: ${typeof volumeDb})`, "blue");
    const volumeDbNum = Number(volumeDb) || 0;
    log(`[VOLUME] Parsed volumeDb: ${volumeDbNum}dB`, "blue");
    log(`[VOLUME] Adjusting volume by ${volumeDbNum}dB`, "blue");
    
    const project = await ppro.Project.getActiveProject();
    if (!project) {
      log("No active project", "red");
      return false;
    }

    if (!audioClip) {
      log("No audio clip provided", "red");
      return false;
    }

    // Get audio component chain
    const audioComponentChain = await audioClip.getComponentChain();
    if (!audioComponentChain) {
      log("No audio component chain", "red");
      return false;
    }

    // Find Gain/Volume parameter by matchName (language-independent)
    // Common audio gain matchName patterns
    const gainMatchPatterns = [
      "Gain", "ADBE Gain", "gain", "Level", "level", "Volume", "volume",
      "Channel Volume", "ADBE Channel Volume"
    ];
    
    // Helper to find a Gain/Volume parameter across all components by matchName
    const findGainParamByMatchName = async () => {
      const compCount = await audioComponentChain.getComponentCount();
      for (let ci = 0; ci < compCount; ci++) {
        try {
          const comp = await audioComponentChain.getComponentAtIndex(ci);
          const paramCount = await comp.getParamCount();
          for (let pi = 0; pi < paramCount; pi++) {
            try {
              const param = await comp.getParam(pi);
              const matchName = await param.getMatchName();
              
              // Check if matchName matches any known gain/volume pattern
              for (const pattern of gainMatchPatterns) {
                if (matchName === pattern || 
                    matchName.toLowerCase().includes(pattern.toLowerCase())) {
                  log(`Found gain param by matchName: ${matchName}`, "green");
                  return param;
                }
              }
            } catch (err) {
              // Continue searching
            }
          }
        } catch (err) {
          // Continue searching
        }
      }
      return null;
    };

    // Try to find existing Gain/Volume parameter by matchName
    let gainParam = await findGainParamByMatchName();

    // If not found, try to add a "Gain" or "Volume" audio filter
    if (!gainParam) {
      try {
        // Get available audio filter matchNames and displayNames
        // Note: Audio filters may only expose displayNames in the API
        // We'll try matchNames first, then fall back to displayNames
        let matchNames = [];
        let displayNames = [];
        
        try {
          matchNames = await ppro.AudioFilterFactory.getMatchNames();
          log(`Available audio filter matchNames: ${matchNames.join(', ')}`, "blue");
        } catch (e) {
          log(`getMatchNames not available for audio filters, using displayNames`, "yellow");
        }
        
        displayNames = await ppro.AudioFilterFactory.getDisplayNames();
        log(`Available audio filter displayNames: ${displayNames.join(', ')}`, "blue");
        
        // Try to find a gain/volume filter by matchName first
        const gainFilterMatchPatterns = [
          "ADBE Channel Volume", "Channel Volume", "ADBE Gain", "Gain",
          "ADBE Hard Limiter", "Hard Limiter", "ADBE Dynamics", "Dynamics"
        ];
        
        let gainFilterName = null;
        let useMatchName = false;
        
        // Try matchNames first
        if (matchNames.length > 0) {
          for (const pattern of gainFilterMatchPatterns) {
            const matching = matchNames.find(mn => 
              mn === pattern || mn.toLowerCase().includes(pattern.toLowerCase())
            );
            if (matching) {
              gainFilterName = matching;
              useMatchName = true;
              break;
            }
          }
        }
        
        // Fall back to displayNames if no matchName found
        // Note: This is less reliable for non-English locales, but some audio APIs
        // only expose displayNames
        if (!gainFilterName) {
          const gainFilterDisplayNames = ["Channel Volume", "Gain", "Hard Limiter", "Dynamics", "Volume"];
          for (const name of gainFilterDisplayNames) {
            const matching = displayNames.find(dn => dn.toLowerCase() === name.toLowerCase());
            if (matching) {
              gainFilterName = matching;
              break;
            }
          }
        }
        
        if (!gainFilterName) {
          log(`Could not find Gain/Volume filter.`, "yellow");
          log("💡 Tip: Audio clips may have built-in volume. Try selecting clips that already have volume/gain effects applied.", "yellow");
          return false;
        }

        // Create and add the gain filter
        log(`Adding audio filter: ${gainFilterName} (useMatchName: ${useMatchName})`, "blue");
        try {
          let gainFilter;
          if (useMatchName) {
            // Use matchName if available (more reliable)
            gainFilter = await ppro.AudioFilterFactory.createComponent(gainFilterName);
          } else {
            // Fall back to displayName
            gainFilter = await ppro.AudioFilterFactory.createComponentByDisplayName(
              gainFilterName,
              audioClip
            );
          }
          const appendAction = await audioComponentChain.createAppendComponentAction(gainFilter);
          await executeAction(project, appendAction);
        } catch (err) {
          log(`Could not add ${gainFilterName} filter: ${err.message || err}`, "yellow");
          log("💡 Tip: Some audio filters may not be compatible. Try applying 'Channel Volume' manually first.", "yellow");
          return false;
        }
        
        // Search again for the gain parameter by matchName
        gainParam = await findGainParamByMatchName();
      } catch (err) {
        log(`Could not add Gain/Volume filter: ${err}`, "yellow");
        console.error("Error adding gain filter:", err);
      }
    }

    if (!gainParam) {
      log("Could not find or create gain/volume parameter", "red");
      log("💡 Tip: This clip may not have a volume parameter. Try applying 'Channel Volume' or 'Gain' audio filter manually first, or select a different audio clip.", "yellow");
      return false;
    }

    // Helper function to extract numeric value from objects (efficient extraction)
    // Used for extracting volume values from getValueAtTime() or Keyframe.value objects
    function extractNumericValue(obj, source) {
      if (obj === null || obj === undefined) return null;
      
      // Direct number check
      if (typeof obj === 'number' && !isNaN(obj)) {
        return obj;
      }
      
      // Check .value property (most common)
      if ('value' in obj) {
        const val = obj.value;
        if (typeof val === 'number' && !isNaN(val)) {
          log(`[VOLUME] Found number in ${source}.value = ${val}dB`, "blue");
          return val;
        }
        // Check nested .value.value
        if (typeof val === 'object' && val !== null && 'value' in val) {
          const nestedVal = val.value;
          if (typeof nestedVal === 'number' && !isNaN(nestedVal)) {
            log(`[VOLUME] Found number in ${source}.value.value = ${nestedVal}dB`, "blue");
            return nestedVal;
          }
        }
      }
      
      // Check all properties for a number (fallback)
      for (const key in obj) {
        const prop = obj[key];
        if (typeof prop === 'number' && !isNaN(prop)) {
          log(`[VOLUME] Found number in ${source}.${key} = ${prop}dB`, "blue");
          return prop;
        }
      }
      
      return null;
    }
    
    // Get current volume value - following Premiere Pro UXP API documentation
    // API Reference: ComponentParam.getValueAtTime(time) → Promise<number | string | boolean | PointF | Color>
    //                For numeric parameters (like volume/gain), should return number directly
    // API Reference: ComponentParam.getStartValue() → Promise<Keyframe>
    //                Keyframe.value is an object that contains the actual value
    let currentValue = 0;
    
    try {
      const clipInPoint = await audioClip.getInPoint();
      log(`[VOLUME] Step 1: Clip in point = ${clipInPoint.seconds}s`, "blue");
      
      // Method 1: Try getValueAtTime() - preferred method per API docs
      let valueExtracted = false;
      try {
        log(`[VOLUME] Step 2: Calling getValueAtTime(${clipInPoint.seconds}s)...`, "blue");
        const valueAtTime = await gainParam.getValueAtTime(clipInPoint);
        log(`[VOLUME] Step 3: getValueAtTime() returned:`, valueAtTime, "blue");
        log(`[VOLUME] Step 4: Return type = ${typeof valueAtTime}`, "blue");
        
        // Extract numeric value efficiently
        if (typeof valueAtTime === 'number' && !isNaN(valueAtTime)) {
          currentValue = valueAtTime;
          valueExtracted = true;
          log(`[VOLUME] ✅ SUCCESS: Direct number extraction = ${currentValue}dB`, "green");
        } else if (typeof valueAtTime === 'object' && valueAtTime !== null) {
          log(`[VOLUME] Step 5: Object detected, inspecting structure...`, "blue");
          log(`[VOLUME] Step 6: Object keys = [${Object.keys(valueAtTime).join(', ')}]`, "blue");
          log(`[VOLUME] Step 7: Object JSON = ${JSON.stringify(valueAtTime)}`, "blue");
          
          // Try common extraction paths: .value, .value.value
          const extracted = extractNumericValue(valueAtTime, "getValueAtTime()");
          if (extracted !== null) {
            currentValue = extracted;
            valueExtracted = true;
            log(`[VOLUME] ✅ SUCCESS: Extracted from object = ${currentValue}dB`, "green");
          }
        }
        
        if (!valueExtracted) {
          log(`[VOLUME] ⚠️ WARNING: Could not extract number from getValueAtTime(), trying fallback...`, "yellow");
          throw new Error("getValueAtTime did not return extractable number");
        }
      } catch (e) {
        log(`[VOLUME] Step 8: getValueAtTime() failed: ${e.message}`, "yellow");
        
        // Method 2: Fallback to getStartValue() - returns Keyframe object
        try {
          log(`[VOLUME] Step 9: Calling getStartValue() as fallback...`, "blue");
          const keyframe = await gainParam.getStartValue();
          log(`[VOLUME] Step 10: getStartValue() returned Keyframe:`, keyframe, "blue");
          log(`[VOLUME] Step 11: Keyframe type = ${typeof keyframe}`, "blue");
          log(`[VOLUME] Step 12: Keyframe keys = [${Object.keys(keyframe || {}).join(', ')}]`, "blue");
          
          if (keyframe && 'value' in keyframe) {
            const keyframeValue = keyframe.value;
            log(`[VOLUME] Step 13: Keyframe.value =`, keyframeValue, "blue");
            log(`[VOLUME] Step 14: Keyframe.value type = ${typeof keyframeValue}`, "blue");
            
            if (typeof keyframeValue === 'number' && !isNaN(keyframeValue)) {
              currentValue = keyframeValue;
              valueExtracted = true;
              log(`[VOLUME] ✅ SUCCESS: Direct Keyframe.value = ${currentValue}dB`, "green");
            } else if (typeof keyframeValue === 'object' && keyframeValue !== null) {
              log(`[VOLUME] Step 15: Keyframe.value is object, keys = [${Object.keys(keyframeValue).join(', ')}]`, "blue");
              log(`[VOLUME] Step 16: Keyframe.value JSON = ${JSON.stringify(keyframeValue)}`, "blue");
              
              const extracted = extractNumericValue(keyframeValue, "Keyframe.value");
              if (extracted !== null) {
                currentValue = extracted;
                valueExtracted = true;
                log(`[VOLUME] ✅ SUCCESS: Extracted from Keyframe.value = ${currentValue}dB`, "green");
              }
            }
          }
          
          if (!valueExtracted) {
            log(`[VOLUME] ⚠️ WARNING: Could not extract number from getStartValue()`, "yellow");
          }
        } catch (e2) {
          log(`[VOLUME] ❌ ERROR: getStartValue() failed: ${e2.message}`, "red");
          console.error("[VOLUME] getStartValue() error details:", e2);
        }
      }
      
      // Final validation and logging
      if (!valueExtracted || typeof currentValue !== 'number' || isNaN(currentValue)) {
        log(`[VOLUME] ⚠️ WARNING: Could not extract valid volume, defaulting to 0dB`, "yellow");
        log(`[VOLUME] ⚠️ WARNING: valueExtracted=${valueExtracted}, currentValue=${currentValue}, type=${typeof currentValue}`, "yellow");
        currentValue = 0;
      }
      
      log(`[VOLUME] ✅ FINAL: Current volume (linear) = ${currentValue}`, "blue");
      
    } catch (err) {
      log(`[VOLUME] ❌ EXCEPTION: ${err.message}`, "red");
      console.error("[VOLUME] Exception details:", err);
      console.error("[VOLUME] Exception stack:", err.stack);
      currentValue = 1.0; // Default to unity gain (1.0 = 0dB linear multiplier)
    }

    // CRITICAL: Premiere Pro's gain/volume parameters use LINEAR MULTIPLIERS, not dB!
    // Conversion formulas:
    //   linear = 10^(dB/20)   (dB to linear)
    //   dB = 20 * log10(linear)   (linear to dB)
    // Examples:
    //   1.0 = 0dB (unity gain)
    //   2.0 = +6dB (double amplitude)
    //   0.5 = -6dB (half amplitude)
    //   0.224 ≈ -13dB
    
    log(`[VOLUME] Step 17: Converting between linear and dB scales...`, "blue");
    log(`[VOLUME] Step 18: Current value (linear) = ${currentValue}`, "blue");
    
    // Convert current linear value to dB
    const currentValueDb = 20 * Math.log10(Math.max(currentValue, 0.0001)); // Avoid log(0)
    log(`[VOLUME] Step 19: Current value in dB = ${currentValueDb.toFixed(2)}dB`, "blue");
    
    // User wants to adjust by this many dB
    const adjustmentDb = volumeDbNum;
    log(`[VOLUME] Step 20: Adjustment amount = ${adjustmentDb}dB`, "blue");
    
    // Calculate new dB value (relative adjustment)
    const newValueDb = currentValueDb + adjustmentDb;
    log(`[VOLUME] Step 21: New value in dB = ${newValueDb.toFixed(2)}dB (${currentValueDb.toFixed(2)}dB + ${adjustmentDb}dB)`, "blue");
    
    // Convert back to linear multiplier for Premiere Pro
    const finalValue = Math.pow(10, newValueDb / 20);
    log(`[VOLUME] Step 22: Converting back to linear: 10^(${newValueDb.toFixed(2)}/20) = ${finalValue.toFixed(6)}`, "blue");
    log(`[VOLUME] Step 23: Setting volume to linear value ${finalValue.toFixed(6)} (equivalent to ${newValueDb.toFixed(2)}dB)`, "blue");
    
    log(`[VOLUME] Step 24: Final values - Current: ${currentValue} (linear) = ${currentValueDb.toFixed(2)}dB, Adjustment: ${adjustmentDb}dB, New: ${finalValue.toFixed(6)} (linear) = ${newValueDb.toFixed(2)}dB`, "blue");

    // Set value using Premiere Pro UXP API pattern
    // API Reference: ComponentParam.createKeyframe(value) → Keyframe
    //                ComponentParam.createSetValueAction(keyframe, isTimeVarying) → Action
    log(`[VOLUME] Step 25: Setting volume using UXP API...`, "blue");
    log(`[VOLUME] Step 26: About to set linear value = ${finalValue.toFixed(6)} (type: ${typeof finalValue})`, "blue");
    
    try {
      log(`[VOLUME] Step 27: Creating keyframe with linear value ${finalValue.toFixed(6)}...`, "blue");
      const keyframe = await gainParam.createKeyframe(Number(finalValue));
      log(`[VOLUME] Step 28: Keyframe created successfully`, "blue");
      log(`[VOLUME] Step 29: Keyframe object:`, keyframe, "blue");
      log(`[VOLUME] Step 30: Keyframe.value:`, keyframe && keyframe.value, "blue");
      
      log(`[VOLUME] Step 31: Creating setValueAction (isTimeVarying=true)...`, "blue");
      const setAction = await gainParam.createSetValueAction(keyframe, true);
      log(`[VOLUME] Step 32: Action created successfully`, "blue");
      
      log(`[VOLUME] Step 33: Executing action...`, "blue");
      await executeAction(project, setAction);
      log(`[VOLUME] Step 34: Action executed successfully`, "blue");
      
      // Verify what value was actually set by reading it back
      log(`[VOLUME] Step 35: Verifying set value by reading it back...`, "blue");
      try {
        const clipInPointForVerify = await audioClip.getInPoint();
        const verifyValue = await gainParam.getValueAtTime(clipInPointForVerify);
        log(`[VOLUME] Step 36: Read back value:`, verifyValue, "blue");
        const extractedVerify = extractNumericValue(verifyValue, "verify");
        if (extractedVerify !== null) {
          const verifyDb = 20 * Math.log10(Math.max(extractedVerify, 0.0001));
          log(`[VOLUME] Step 37: Extracted verify value: ${extractedVerify} (linear) = ${verifyDb.toFixed(2)}dB`, "blue");
          if (Math.abs(extractedVerify - finalValue) > 0.01) {
            log(`[VOLUME] ⚠️ WARNING: Set ${finalValue.toFixed(6)} (${newValueDb.toFixed(2)}dB) but read back ${extractedVerify} (${verifyDb.toFixed(2)}dB) - Premiere Pro may have changed it!`, "yellow");
          }
        }
      } catch (verifyErr) {
        log(`[VOLUME] ⚠️ Could not verify set value: ${verifyErr.message}`, "yellow");
      }
      
      log(`[VOLUME] ✅ SUCCESS: Volume adjusted ${currentValueDb.toFixed(2)}dB → ${newValueDb.toFixed(2)}dB (${adjustmentDb > 0 ? '+' : ''}${adjustmentDb}dB)`, "green");
      return true;
    } catch (err) {
      log(`[VOLUME] ⚠️ WARNING: Keyframe method failed: ${err.message}`, "yellow");
      console.error("[VOLUME] Keyframe method error:", err);
      console.error("[VOLUME] Error stack:", err.stack);
      
      // Fallback: Try direct setValue (some audio params might not support keyframes)
      try {
        log(`[VOLUME] Step 38: Trying fallback method (direct setValue, isTimeVarying=false)...`, "yellow");
        log(`[VOLUME] Step 39: About to set linear value = ${finalValue.toFixed(6)} directly...`, "blue");
        const setValueAction = await gainParam.createSetValueAction(Number(finalValue), false);
        log(`[VOLUME] Step 40: Fallback action created`, "blue");
        
        await executeAction(project, setValueAction);
        log(`[VOLUME] ✅ SUCCESS (fallback): Volume adjusted ${currentValueDb.toFixed(2)}dB → ${newValueDb.toFixed(2)}dB`, "green");
        return true;
      } catch (err2) {
        log(`[VOLUME] ❌ ERROR: Both methods failed. Last error: ${err2.message || err2}`, "red");
        console.error("[VOLUME] Fallback method error:", err2);
        console.error("[VOLUME] Error stack:", err2.stack);
        return false;
      }
    }
  } catch (err) {
    log(`Error adjusting volume: ${err}`, "red");
    console.error("adjustVolume error details:", err);
    return false;
  }
}

// ============ DEMO/TEST FUNCTIONS ============

/**
 * Simple test - zoom in on first selected clip
 */
export async function testZoom() {
  log("🧪 Testing zoom functionality...", "blue");
  
  const project = await ppro.Project.getActiveProject();
  if (!project) {
    log("No active project", "red");
    return;
  }

  const sequence = await project.getActiveSequence();
  if (!sequence) {
    log("No sequence found", "red");
    return;
  }

  const selection = await sequence.getSelection();
  if (!selection) {
    log("No selection found", "red");
    return;
  }

  const trackItems = await selection.getTrackItems();
  if (!trackItems || trackItems.length === 0) {
    log("❌ No clips selected. Please select a clip on the timeline.", "red");
    return;
  }

  log(`Found ${trackItems.length} selected clip(s)`, "blue");

  // Test zoom in on all selected clips
  const result = await zoomInBatch(trackItems, {
    startScale: 100,
    endScale: 150,
    interpolation: 'BEZIER'
  });

  log(`🎉 Test complete! ${result.successful} clips zoomed successfully.`, "green");
}

// ============ PARAMETER MODIFICATION ============

/**
 * Get all modifiable parameters from a clip's effects
 * @param {TrackItem} trackItem - The clip to inspect
 * @returns {Promise<Array>} Array of parameter info objects with matchNames
 */
export async function getEffectParameters(trackItem) {
  try {
    if (!trackItem) {
      log("No track item provided", "red");
      return [];
    }

    const componentChain = await trackItem.getComponentChain();
    if (!componentChain) {
      log("No component chain", "red");
      return [];
    }

    const parameters = [];
    const compCount = await componentChain.getComponentCount();
    
    for (let ci = 0; ci < compCount; ci++) {
      const comp = await componentChain.getComponentAtIndex(ci);
      const compMatchName = await comp.getMatchName();
      const compDisplayName = await comp.getDisplayName();
      
      // Skip built-in components (Opacity, Motion) unless user explicitly wants them
      const isBuiltIn = compMatchName.includes("ADBE Opacity") || compMatchName.includes("ADBE Motion");
      
      const paramCount = await comp.getParamCount();
      for (let pi = 0; pi < paramCount; pi++) {
        const param = await comp.getParam(pi);
        
        // Get both matchName (language-independent) and displayName
        let paramMatchName = "";
        try {
          paramMatchName = await param.getMatchName();
        } catch (e) {
          // Some params may not have matchName, continue
        }
        
        const paramDisplayName = (param && param.displayName ? param.displayName : "").trim();
        
        // Skip params without any identifier
        if (!paramMatchName && !paramDisplayName) continue;
        
        parameters.push({
          componentIndex: ci,
          paramIndex: pi,
          componentMatchName: compMatchName,
          componentDisplayName: compDisplayName,
          paramMatchName: paramMatchName,        // Language-independent (preferred)
          paramDisplayName: paramDisplayName,    // Localized (fallback)
          param: param,
          isBuiltIn: isBuiltIn
        });
      }
    }
    
    log(`Found ${parameters.length} parameters across ${compCount} components`, "blue");
    return parameters;
  } catch (err) {
    log(`Error getting effect parameters: ${err}`, "red");
    return [];
  }
}

/**
 * Modify a specific effect parameter on a clip
 * @param {TrackItem} trackItem - The clip to modify
 * @param {Object} options - Modification options
 * @param {string} options.parameterName - matchName or readable name of the parameter (matchName preferred)
 * @param {number} options.value - New value for the parameter
 * @param {string} options.componentName - (Optional) matchName or name of the component/effect
 * @param {boolean} options.excludeBuiltIn - Whether to exclude built-in effects like Motion/Opacity (default: true)
 * @returns {Promise<boolean>}
 */
export async function modifyEffectParameter(trackItem, options = {}) {
  try {
    const {
      parameterName,
      value,
      startValue,
      animated = false,
      duration = null,
      startTime = 0,
      interpolation = 'LINEAR',
      componentName = null,
      excludeBuiltIn = true
    } = options;

    if (!parameterName) {
      log("Parameter name is required", "red");
      return false;
    }

    if (value === undefined || value === null) {
      log("Parameter value is required", "red");
      return false;
    }

    log(`Looking for parameter "${parameterName}" to set to ${value}${animated ? ' (animated)' : ''}`, "blue");

    // Get all parameters (now includes matchNames)
    const allParams = await getEffectParameters(trackItem);
    
    if (allParams.length === 0) {
      log("No parameters found on this clip", "red");
      return false;
    }

    // Filter parameters
    let candidates = allParams;
    
    // Exclude built-in if requested
    if (excludeBuiltIn) {
      candidates = candidates.filter(p => !p.isBuiltIn);
      log(`Filtered to ${candidates.length} non-built-in parameters`, "blue");
    }
    
    // Filter by component name if specified (check matchName first, then displayName)
    if (componentName) {
      const componentLower = componentName.toLowerCase();
      candidates = candidates.filter(p => 
        p.componentMatchName.toLowerCase().includes(componentLower) ||
        p.componentDisplayName.toLowerCase().includes(componentLower)
      );
      log(`Filtered to ${candidates.length} parameters in component "${componentName}"`, "blue");
    }
    
    // Check if parameterName looks like a matchName (contains ADBE or common patterns)
    const isMatchNameInput = parameterName.includes('ADBE') || parameterName.includes('-000');
    
    // Resolve readable name to matchName if we have a mapping
    const paramLower = parameterName.toLowerCase();
    const resolvedMatchName = PARAM_NAME_TO_MATCHNAME[paramLower];
    
    let match = null;
    
    // Strategy 1: Direct matchName match (if input looks like a matchName)
    if (isMatchNameInput) {
      match = candidates.find(p => 
        p.paramMatchName === parameterName ||
        p.paramMatchName.toLowerCase().includes(paramLower)
      );
      if (match) {
        log(`Direct matchName match found: ${match.paramMatchName}`, "green");
      }
    }
    
    // Strategy 2: Use our mapping to find by resolved matchName
    if (!match && resolvedMatchName) {
      const patterns = Array.isArray(resolvedMatchName) ? resolvedMatchName : [resolvedMatchName];
      for (const pattern of patterns) {
        match = candidates.find(p => 
          p.paramMatchName === pattern ||
          p.paramMatchName.toLowerCase().includes(pattern.toLowerCase())
        );
        if (match) {
          log(`Matched via mapping: "${parameterName}" → ${match.paramMatchName}`, "green");
          break;
        }
      }
    }
    
    // Strategy 3: Fuzzy matchName search
    if (!match) {
      match = candidates.find(p => 
        p.paramMatchName && (
          p.paramMatchName.toLowerCase() === paramLower ||
          p.paramMatchName.toLowerCase().includes(paramLower) ||
          paramLower.includes(p.paramMatchName.toLowerCase())
        )
      );
      if (match) {
        log(`Fuzzy matchName match: ${match.paramMatchName}`, "green");
      }
    }
    
    // Strategy 4: Fall back to displayName matching (less reliable for non-English)
    if (!match) {
      log(`No matchName match, falling back to displayName search`, "yellow");
      match = candidates.find(p => 
        p.paramDisplayName.toLowerCase() === paramLower ||
        p.paramDisplayName.toLowerCase().includes(paramLower) ||
        paramLower.includes(p.paramDisplayName.toLowerCase())
      );
    }

    if (!match) {
      log(`❌ Parameter "${parameterName}" not found`, "red");
      // Show both matchNames and displayNames for debugging
      log(`Available matchNames: ${candidates.map(p => p.paramMatchName).filter(Boolean).join(', ')}`, "yellow");
      log(`Available displayNames: ${candidates.map(p => p.paramDisplayName).join(', ')}`, "yellow");
      return false;
    }

    log(`✓ Found parameter: matchName="${match.paramMatchName}" display="${match.paramDisplayName}" in ${match.componentMatchName}`, "green");

    // Get project for executing action
    const project = await ppro.Project.getActiveProject();
    if (!project) {
      log("No active project", "red");
      return false;
    }

    const param = match.param;

    if (animated) {
      // Animation logic (Keyframes)
      const clipDuration = await getClipDuration(trackItem);
      const clipStartTime = await getClipInPoint(trackItem);
      
      if (clipDuration === null || clipStartTime === null) {
        log(`❌ Could not get clip timing information for animation`, "red");
        return false;
      }
      
      const animDuration = duration !== null ? Number(duration) : clipDuration;
      const absoluteStartTime = clipStartTime + Number(startTime);
      const absoluteEndTime = absoluteStartTime + animDuration;
      
      // Determine start value
      let actualStartValue = startValue;
      if (actualStartValue === undefined || actualStartValue === null) {
        // If startValue is not provided, try to determine it dynamically
        try {
          // If we have a specific start time, get the value at that time (crucial for chains/loops)
          if (startTime > 0) {
             const valAtTime = await param.getValueAtTime(
               ppro.TickTime.createWithSeconds(absoluteStartTime)
             );
             actualStartValue = (valAtTime && typeof valAtTime.getValue === 'function')
               ? await valAtTime.getValue()
               : Number(valAtTime);
             log(`Dynamically determined startValue at ${startTime}s: ${actualStartValue}`, "blue");
          } else {
             // Otherwise fallback to current CTI value or static value
             const curr = await param.getValue();
             actualStartValue = (curr && typeof curr.getValue === 'function') 
               ? await curr.getValue() 
               : Number(curr);
          }
        } catch(e) {
          log(`Could not get current value, defaulting start value to 0`, "yellow");
          actualStartValue = 0;
        }
      }
      
      log(`Animating "${match.paramDisplayName}" from ${actualStartValue} to ${value} over ${animDuration}s`, "blue");
      log(`Keyframes: ${absoluteStartTime.toFixed(2)}s -> ${absoluteEndTime.toFixed(2)}s`, "blue");
      
      // Add start keyframe
      const startSuccess = await addKeyframe(
        param, 
        project, 
        absoluteStartTime, 
        Number(actualStartValue), 
        interpolation
      );
      
      if (!startSuccess) {
        log("❌ Failed to create start keyframe", "red");
        return false;
      }
      
      // Add end keyframe
      const endSuccess = await addKeyframe(
        param, 
        project, 
        absoluteEndTime, 
        Number(value), 
        interpolation
      );
      
      if (!endSuccess) {
        log("❌ Failed to create end keyframe", "red");
        return false;
      }
      
      log(`✅ Parameter "${match.paramDisplayName}" animated successfully`, "green");
      
    } else {
      // Static value logic (existing behavior)
      const keyframe = param.createKeyframe(Number(value));
      const setAction = param.createSetValueAction(keyframe, true);
      await executeAction(project, setAction);
      log(`✅ Parameter "${match.paramDisplayName}" set to ${value}`, "green");
    }

    return true;

  } catch (err) {
    log(`❌ Error modifying parameter: ${err}`, "red");
    console.error("Parameter modification error details:", err);
    return false;
  }
}

/**
 * Modify multiple parameters on a clip in batch
 * @param {TrackItem} trackItem - The clip to modify
 * @param {Array<Object>} modifications - Array of {parameterName, value, componentName?} objects
 * @param {boolean} excludeBuiltIn - Whether to exclude built-in effects (default: true)
 * @returns {Promise<{successful: number, failed: number}>}
 */
export async function modifyEffectParametersBatch(trackItem, modifications, excludeBuiltIn = true) {
  log(`Modifying ${modifications.length} parameter(s) on clip...`, "blue");
  
  let successful = 0;
  let failed = 0;

  for (let i = 0; i < modifications.length; i++) {
    const mod = modifications[i];
    log(`Processing modification ${i + 1}/${modifications.length}: ${mod.parameterName} = ${mod.value}`, "blue");
    
    const result = await modifyEffectParameter(trackItem, {
      ...mod,
      excludeBuiltIn
    });
    
    if (result) {
      successful++;
    } else {
      failed++;
    }
  }

  log(`✅ Batch complete: ${successful} successful, ${failed} failed`, "green");
  return { successful, failed };
}
