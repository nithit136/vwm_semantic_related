/*
 * script.js
 *
 * This file contains the logic necessary to run the Visual Working Memory
 * experiment entirely within a web browser.  It mirrors the structure of the
 * provided PsychoPy code but is written in plain JavaScript and uses the DOM
 * to present stimuli and collect responses.  The experiment flows through the
 * following phases:
 *   1) Collect participant information via a simple form.
 *   2) Present instructions across three screens, advancing on Enter.
 *   3) For each of the 360 trials, display a fixation cross, a set of
 *      coloured object stimuli at variable positions for a specified encoding
 *      duration, a second fixation, and finally a four-alternative forced
 *      choice (4AFC) response screen.
 *   4) Record responses, reaction times, and accuracy.
 *   5) Save the resulting data as a downloadable JSON file and thank the
 *      participant.
 *
 * To use your own images, create a folder called `stimuli_folder` in the
 * experiment directory containing subfolders named `size2`, `size4` and
 * `size6`.  Within each size folder create subfolders for each category
 * (e.g. `cat_1`, `cat_2`, ..., `cat_10`) and place your image files there
 * using the naming convention `objX_sY.jpg` (e.g. `obj1_s1.jpg`).  Two
 * instruction images named `instr1.png` and `instr2.png` should also be
 * placed in the experiment directory.
 */

(() => {
  // Cache object used by the image preloader.  Each key is an image
  // path and the corresponding value is a loaded Image object.  By
  // storing references here, the browser keeps the resources in
  // memory, avoiding additional network requests during the task.
  const IMAGE_CACHE = {};
  // Helper functions for randomisation and combinatorial logic
  /**
   * Shuffle an array in place using the Fisher–Yates algorithm.
   * @param {Array} array The array to shuffle
   * @returns {Array} The shuffled array
   */
  function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  /**
   * Generate all permutations of length k from the elements of arr.
   * @param {Array} arr Source array
   * @param {number} k Length of each permutation
   * @returns {Array<Array>} List of permutations
   */
  function permutations(arr, k) {
    const results = [];
    function helper(current, remaining) {
      if (current.length === k) {
        results.push(current.slice());
        return;
      }
      for (let i = 0; i < remaining.length; i++) {
        const next = remaining[i];
        const rest = remaining.slice(0, i).concat(remaining.slice(i + 1));
        helper(current.concat(next), rest);
      }
    }
    helper([], arr);
    return results;
  }

  /**
   * Generate all k-combinations of the elements of arr.
   * @param {Array} arr Source array
   * @param {number} k Number of elements per combination
   * @returns {Array<Array>} List of combinations
   */
  function combinations(arr, k) {
    const results = [];
    function combine(start, combo) {
      if (combo.length === k) {
        results.push(combo.slice());
        return;
      }
      for (let i = start; i < arr.length; i++) {
        combo.push(arr[i]);
        combine(i + 1, combo);
        combo.pop();
      }
    }
    combine(0, []);
    return results;
  }

  /**
   * Generate all combinations of 's1' and 's2' repeated n times.
   * Equivalent to computing a Cartesian product of length n.
   * @param {number} n Number of elements in each state sequence
   * @returns {Array<Array>} List of state combinations
   */
  function getStates(n) {
    const results = [];
    function helper(prefix, depth) {
      if (depth === n) {
        results.push(prefix.slice());
        return;
      }
      ['s1', 's2'].forEach(s => {
        prefix.push(s);
        helper(prefix, depth + 1);
        prefix.pop();
      });
    }
    helper([], 0);
    return results;
  }

  /**
   * Create combos for unrelated conditions.  Given a fixed category and
   * the number of additional categories to select, returns 12 randomly
   * selected combinations, each beginning with the fixed category.
   * @param {string} fixedCat The fixed category
   * @param {number} nCombo Number of other categories to choose
   * @returns {Array<Array>} A list of category combinations
   */
  function makeCombos(fixedCat, nCombo, categories) {
    const others = categories.filter(c => c !== fixedCat);
    const allCombos = combinations(others, nCombo);
    shuffle(allCombos);
    const selected = allCombos.slice(0, 12);
    return selected.map(c => [fixedCat, ...c]);
  }

  /**
   * Generate foil categories for the two-alternative 4AFC task.  For each
   * selection of categories, choose one foil category that is not present
   * in the selection and return a pair [targetCat, foilCat].
   * @param {Array<Array>} selectedCat List of category selections
   * @param {Array<string>} categories Master list of all categories
   * @returns {Array<Array>} A list of [targetCat, foilCat] pairs
   */
  function makeAfcCat(selectedCat, categories) {
    const afcCat = [];
    for (const c of selectedCat) {
      const exclude = new Set(c);
      const others = categories.filter(x => !exclude.has(x));
      const foilCat = others[Math.floor(Math.random() * others.length)];
      afcCat.push([c[0], foilCat]);
    }
    return afcCat;
  }

  /**
   * Precompute all stimuli and associated metadata for each set size,
   * context and category.  This mirrors the logic in the original PsychoPy
   * script.  The resulting structure is stored on the global `stimulusDict`
   * variable for later lookup.
   *
   * stimulusDict has the following structure:
   * {
   *   size2: {
   *     related: {
   *       cat_1: {
   *         category: [[cat_1, cat_1], ..., 12 entries],
   *         stimulus: [[obj1, obj2], ..., 12 entries],
   *         state: [[s1, s2], ..., 12 entries],
   *         afc_cat: [[cat_1, foil], ..., 12 entries],
   *         afc_stim: [[objA, objB], ..., 12 entries]
   *       },
   *       ...
   *     },
   *     unrelated: { ... },
   *   },
   *   size4: { ... },
   *   size6: { ... }
   * }
   */
  function buildStimulusDict() {
    const stimulusDict = {};
    // General parameters
    const categories = Array.from({ length: 10 }, (_, i) => `cat_${i + 1}`);
    // Define objects for each set size
    const obj2 = ['obj1', 'obj2', 'obj3', 'obj4'];
    const obj4 = ['obj1', 'obj2', 'obj3', 'obj4'];
    const obj6 = ['obj1', 'obj2', 'obj3', 'obj4', 'obj5', 'obj6'];
    // State sequences
    const ss2Base = getStates(2); // Four possible combinations
    const ss2State = [];
    // Repeat base states three times to get 12 items
    for (let i = 0; i < 3; i++) {
      ss2State.push(...ss2Base.map(s => s.slice()));
    }

  /**
   * Build a flat list of all image paths used in the experiment.  This
   * includes every possible stimulus image (across all set sizes,
   * categories, objects and states) as well as the instruction images.
   * These paths are used by the image preloader so that every image can
   * be fetched and cached before the experiment starts.  Having images
   * loaded up front avoids missing or delayed stimuli when trials run.
   *
   * @returns {Array<string>} List of relative image paths
   */
  function buildAllImagePaths() {
    const paths = [];
    // Define set sizes and corresponding objects; this mirrors the
    // structure used when computing the stimulus dictionary.  Note that
    // size4 uses the same objects as size2 in this particular task.
    const setSizes = ['size2', 'size4', 'size6'];
    const objectsBySet = {
      size2: ['obj1', 'obj2', 'obj3', 'obj4'],
      size4: ['obj1', 'obj2', 'obj3', 'obj4'],
      size6: ['obj1', 'obj2', 'obj3', 'obj4', 'obj5', 'obj6']
    };
    const states = ['s1', 's2'];
    // Use the global categoriesList defined below.  This ensures that
    // modifications to the category list propagate to the preloader.
    setSizes.forEach(ss => {
      const objs = objectsBySet[ss];
      categoriesList.forEach(cat => {
        objs.forEach(obj => {
          states.forEach(st => {
            const relPath = `stimuli_folder/${ss}/${cat}/${obj}_${st}.jpg`;
            paths.push(relPath);
          });
        });
      });
    });
    // Also include the instruction images which are referenced in the
    // instruction screens.  These files should live alongside index.html.
    paths.push('instr1.png');
    paths.push('instr2.png');
    return paths;
  }

  /**
   * Preload all experiment images before the task begins.  Given a list
   * of image paths, this function creates Image objects, assigns each
   * path to the src attribute, and resolves a promise when all images
   * have either loaded or failed.  Successfully loaded images are
   * stored on the IMAGE_CACHE object for potential later reuse.
   *
   * An optional callback can be supplied to monitor progress.  It is
   * invoked with (loadedCount, totalCount, path, success) each time an
   * image finishes loading (or fails).  This can be used to update a
   * progress indicator on screen if desired.
   *
   * @param {Function} updateProgressCallback Optional progress callback
   * @returns {Promise<{failed: Array<string>}>} Resolves when all images are attempted
   */
  function preloadImages() {
    const paths = buildAllImagePaths();
    const total = paths.length;
    let loadedCount = 0;
    const failed = [];
    return new Promise(resolve => {
      paths.forEach(path => {
        const img = new Image();
        img.onload = () => {
          // Cache the image using the relative path as key
          IMAGE_CACHE[path] = img;
          loadedCount++;
          if (updateProgressCallback) {
            updateProgressCallback(loadedCount, total, path, true);
          }
          if (loadedCount === total) {
            resolve({ failed });
          }
        };
        img.onerror = () => {
          console.warn('Failed to preload image:', path);
          failed.push(path);
          loadedCount++;
          if (updateProgressCallback) {
            updateProgressCallback(loadedCount, total, path, false);
          }
          if (loadedCount === total) {
            resolve({ failed });
          }
        };
        img.src = path;
      });
    });
  }
    const ss4State = getStates(4);
    const ss6State = getStates(6);
    // Precompute permutations for related size2 (4P2 = 12)
    const perm2 = permutations(obj2, 2);
    // Precompute for size4 related (4 objects repeated 3 times)
    const stim4Related = [];
    for (const f of obj4) {
      const rest = obj4.filter(o => o !== f);
      for (let rep = 0; rep < 3; rep++) {
        const restShuf = shuffle(rest.slice());
        stim4Related.push([f, ...restShuf]);
      }
    }
    // Precompute for size6 related (6 objects repeated twice)
    const stim6Related = [];
    for (const f of obj6) {
      const rest = obj6.filter(o => o !== f);
      for (let rep = 0; rep < 2; rep++) {
        const restShuf = shuffle(rest.slice());
        stim6Related.push([f, ...restShuf]);
      }
    }
    // Build structures for each set size
    // Helper to create afc_stim for any list of stimuli
    function createAfcStim(stimulusList, objects) {
      const afcStim = [];
      for (const stim of stimulusList) {
        // stim is an array of objects where the first element is the critical object
        const f = stim[0];
        // Create a full copy of objects and select a random entry as the foil
        const rest = shuffle(objects.slice());
        // Append both the original and random object for later use
        afcStim.push([f, rest[0]]);
      }
      return afcStim;
    }
    // Build dictionary for each set size
    ['size2', 'size4', 'size6'].forEach(ss => {
      stimulusDict[ss] = { related: {}, unrelated: {} };
    });
    // Iterate over categories and fill out dictionaries
    for (const cat of categories) {
      // ----- size 2 -----
      {
        // Related
        const relatedCat = [];
        for (let i = 0; i < 12; i++) relatedCat.push([cat, cat]);
        const relatedStim = perm2.map(pair => pair.slice());
        const relatedState = shuffle(ss2State.slice());
        const relatedAfcCat = makeAfcCat(new Array(12).fill(null).map(() => [cat]), categories);
        const relatedAfcStim = createAfcStim(relatedStim, obj2);
        stimulusDict['size2'].related[cat] = {
          category: relatedCat,
          stimulus: relatedStim,
          state: relatedState,
          afc_cat: relatedAfcCat,
          afc_stim: relatedAfcStim
        };
        // Unrelated
        const combos1 = makeCombos(cat, 1, categories);
        const combos2 = makeCombos(cat, 1, categories).slice(0, 3);
        const diffCat = combos1.concat(combos2);
        // Stimuli: for each object (4) repeated 3 times
        const unrelatedStim = [];
        for (const f of obj2) {
          for (let rep = 0; rep < 3; rep++) {
            const rest = obj2.filter(o => o !== f);
            const restShuf = shuffle(rest.slice());
            unrelatedStim.push([f, restShuf[0]]);
          }
        }
        // States
        const unrelatedState = shuffle(ss2State.slice());
        // afc_cat for unrelated uses diffCat
        const unrelatedAfcCat = makeAfcCat(diffCat, categories);
        // afc_stim: for each of 12 stimuli choose random foil
        const unrelatedAfcStim = [];
        for (const stim of unrelatedStim) {
          const f = stim[0];
          const rest = shuffle(obj2.slice());
          unrelatedAfcStim.push([f, rest[0]]);
        }
        stimulusDict['size2'].unrelated[cat] = {
          category: diffCat,
          stimulus: unrelatedStim,
          state: unrelatedState,
          afc_cat: unrelatedAfcCat,
          afc_stim: unrelatedAfcStim
        };
      }
      // ----- size 4 -----
      {
        // Related
        const relatedCat4 = [];
        for (let i = 0; i < 12; i++) relatedCat4.push([cat, cat]);
        // Stimuli: 4 objects repeated 3 times, excluding the chosen first object
        const relatedStim4 = [];
        for (const f of obj4) {
          const rest = obj4.filter(o => o !== f);
          for (let rep = 0; rep < 3; rep++) {
            const restShuf = shuffle(rest.slice());
            relatedStim4.push([f, ...restShuf]);
          }
        }
        const relatedState4 = shuffle(ss4State.slice());
        const relatedAfcCat4 = makeAfcCat(new Array(12).fill(null).map(() => [cat]), categories);
        const relatedAfcStim4 = createAfcStim(relatedStim4, obj4);
        stimulusDict['size4'].related[cat] = {
          category: relatedCat4,
          stimulus: relatedStim4,
          state: relatedState4.slice(0, 12),
          afc_cat: relatedAfcCat4,
          afc_stim: relatedAfcStim4
        };
        // Unrelated
        const diffCat4 = makeCombos(cat, 3, categories);
        const unrelatedStim4 = [];
        for (const f of obj4) {
          for (let rep = 0; rep < 3; rep++) {
            // For unrelated size4 we do not remove f from rest
            const rest = shuffle(obj4.slice());
            unrelatedStim4.push([f, rest[0], rest[1], rest[2]]);
          }
        }
        const unrelatedState4 = shuffle(ss4State.slice());
        const unrelatedAfcCat4 = makeAfcCat(diffCat4, categories);
        const unrelatedAfcStim4 = [];
        for (const stim of unrelatedStim4) {
          const f = stim[0];
          const rest = shuffle(obj4.slice());
          unrelatedAfcStim4.push([f, rest[0]]);
        }
        stimulusDict['size4'].unrelated[cat] = {
          category: diffCat4,
          stimulus: unrelatedStim4,
          state: unrelatedState4.slice(0, 12),
          afc_cat: unrelatedAfcCat4,
          afc_stim: unrelatedAfcStim4
        };
      }
      // ----- size 6 -----
      {
          // Related
          const relatedCat6 = [];
          for (let i = 0; i < 12; i++) relatedCat6.push(Array(6).fill(cat));
          // Stimuli: 6 objects repeated twice, excluding f from rest
          const relatedStim6 = [];
          for (const f of obj6) {
            for (let rep = 0; rep < 2; rep++) {
              const rest = obj6.filter(o => o !== f);
              const restShuf = shuffle(rest.slice());
              relatedStim6.push([f, ...restShuf]);
            }
          }
          const relatedState6 = shuffle(ss6State.slice());
          const relatedAfcCat6 = makeAfcCat(new Array(12).fill(null).map(() => [cat]), categories);
          const relatedAfcStim6 = createAfcStim(relatedStim6, obj6);
          stimulusDict['size6'].related[cat] = {
            category: relatedCat6,
            stimulus: relatedStim6,
            state: relatedState6.slice(0, 12),
            afc_cat: relatedAfcCat6,
            afc_stim: relatedAfcStim6
          };
          // Unrelated
          const diffCat6 = makeCombos(cat, 5, categories);
          const unrelatedStim6 = [];
          for (const f of obj6) {
            for (let rep = 0; rep < 2; rep++) {
              const rest = shuffle(obj6.slice());
              unrelatedStim6.push([f, rest[0], rest[1], rest[2], rest[3], rest[4]]);
            }
          }
          const unrelatedState6 = shuffle(ss6State.slice());
          const unrelatedAfcCat6 = makeAfcCat(diffCat6, categories);
          const unrelatedAfcStim6 = [];
          for (const stim of unrelatedStim6) {
            const f = stim[0];
            const rest = shuffle(obj6.slice());
            unrelatedAfcStim6.push([f, rest[0]]);
          }
          stimulusDict['size6'].unrelated[cat] = {
            category: diffCat6,
            stimulus: unrelatedStim6,
            state: unrelatedState6.slice(0, 12),
            afc_cat: unrelatedAfcCat6,
            afc_stim: unrelatedAfcStim6
          };
      }
    }
    return stimulusDict;
  }

  // ---------------------------------------------------------------------------
  // Preloading utilities
  // The following functions are defined outside of buildStimulusDict so they
  // can be referenced from elsewhere in the script (e.g. showInstructions).
  // Duplicate definitions exist inside buildStimulusDict for legacy reasons,
  // but those are scoped locally and do not affect the global behaviour.

  /**
   * Build a flat list of all image paths used in the experiment.  This
   * includes every possible stimulus image (across all set sizes,
   * categories, objects and states) as well as the instruction images.
   * These paths are used by the image preloader so that every image can
   * be fetched and cached before the experiment starts.  Having images
   * loaded up front avoids missing or delayed stimuli when trials run.
   *
   * @returns {Array<string>} List of relative image paths
   */
  function buildAllImagePaths() {
    const paths = [];
    const setSizes = ['size2', 'size4', 'size6'];
    const objectsBySet = {
      size2: ['obj1', 'obj2', 'obj3', 'obj4'],
      size4: ['obj1', 'obj2', 'obj3', 'obj4'],
      size6: ['obj1', 'obj2', 'obj3', 'obj4', 'obj5', 'obj6']
    };
    const states = ['s1', 's2'];
    setSizes.forEach(ss => {
      const objs = objectsBySet[ss];
      categoriesList.forEach(cat => {
        objs.forEach(obj => {
          states.forEach(st => {
            const relPath = `stimuli_folder/${ss}/${cat}/${obj}_${st}.jpg`;
            paths.push(relPath);
          });
        });
      });
    });
    paths.push('instr1.png');
    paths.push('instr2.png');
    return paths;
  }

  /**
   * Preload all experiment images before the task begins.  Given a list
   * of image paths, this function creates Image objects, assigns each
   * path to the src attribute, and resolves a promise when all images
   * have either loaded or failed.  Successfully loaded images are
   * stored on the IMAGE_CACHE object for potential later reuse.
   *
   * An optional callback can be supplied to monitor progress.  It is
   * invoked with (loadedCount, totalCount, path, success) each time an
   * image finishes loading (or fails).  This can be used to update a
   * progress indicator on screen if desired.
   *
   * @param {Function} updateProgressCallback Optional progress callback
   * @returns {Promise<{failed: Array<string>}>} Resolves when all images are attempted
   */
  function preloadImages(updateProgressCallback) {
    const paths = buildAllImagePaths();
    const total = paths.length;
    let loadedCount = 0;
    const failed = [];
    return new Promise(resolve => {
      paths.forEach(path => {
        const img = new Image();
        img.onload = () => {
          IMAGE_CACHE[path] = img;
          loadedCount++;
          if (updateProgressCallback) {
            updateProgressCallback(loadedCount, total, path, true);
          }
          if (loadedCount === total) {
            resolve({ failed });
          }
        };
        img.onerror = () => {
          console.warn('Failed to preload image:', path);
          failed.push(path);
          loadedCount++;
          if (updateProgressCallback) {
            updateProgressCallback(loadedCount, total, path, false);
          }
          if (loadedCount === total) {
            resolve({ failed });
          }
        };
        img.src = path;
      });
    });
  }

  /**
   * Create a download link for the given JSON data and display it in the
   * experiment container.  When clicked, the file will be saved to the
   * user's machine.  Optionally triggers an automatic click to start the
   * download immediately.
   * @param {Object} data The data object to convert to JSON
   * @param {string} filename Name of the file to download
   */
  function createDownloadLink(data, filename) {
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.textContent = 'Download results';
    link.style.display = 'block';
    link.style.marginTop = '20px';
    document.getElementById('experiment').appendChild(link);
  }

  /**
   * Wait for the user to press one of the specified keys.  Returns a
   * promise that resolves with the pressed key.
   * @param {Array<string>} keys List of allowed key identifiers
   * @returns {Promise<string>} Promise that resolves with the key pressed
   */
  function waitForKey(keys) {
    return new Promise(resolve => {
      function handleKey(event) {
        const key = event.key;
        if (keys.includes(key)) {
          window.removeEventListener('keydown', handleKey);
          resolve(key);
        }
      }
      window.addEventListener('keydown', handleKey);
    });
  }

  /**
   * Pause execution for a specified duration.
   * @param {number} ms Milliseconds to wait
   * @returns {Promise<void>} Promise that resolves after the delay
   */
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Global variables to hold experiment state
  const categoriesList = Array.from({ length: 10 }, (_, i) => `cat_${i + 1}`);
  const setSize = ['size2', 'size4', 'size6'];
  const encodingTimes = [0.15, 0.5, 1]; // seconds
  const contexts = ['related', 'unrelated'];
  // Stimuli dictionary computed once at start
  const stimulusDict = buildStimulusDict();
  // Condition list and random IDs
  const conditions = [];
  for (let rep = 0; rep < 2; rep++) {
    for (const ss of setSize) {
      for (const et of encodingTimes) {
        for (const ctx of contexts) {
          for (const cat of categoriesList) {
            conditions.push([ss, et, ctx, cat]);
          }
        }
      }
    }
  }
  // Shuffle condition order
  shuffle(conditions);
  // Generate random IDs 0..11 repeated 30 times and shuffle
  const randId = [];
  for (let i = 0; i < 30; i++) {
    for (let j = 0; j < 12; j++) {
      randId.push(j);
    }
  }
  shuffle(randId);
  // Data structure to collect results
  const p = {
    participant: { number: '', age: '' },
    task: {
      trial: [],
      condition: [],
      set_size: [],
      encoding_time: [],
      context: [],
      id: [],
      category: [],
      obj: [],
      state: [],
      stimulus_loc: [],
      afc_cat: [],
      afc_stim: [],
      afc_loc: [],
      response: [],
      rt: [],
      correct_ans: [],
      correct_cat: []
    }
  };

  /**
   * Display the demographic form asking for participant number and age.
   * Once the participant clicks start and the inputs are valid, the
   * experiment proceeds to the instruction screens.
   */
  function showDemographicForm() {
    const container = document.getElementById('experiment');
    container.innerHTML = '';
    const formDiv = document.createElement('div');
    formDiv.className = 'form-container';
    const label1 = document.createElement('label');
    label1.textContent = 'Participant Number:';
    const inputNumber = document.createElement('input');
    inputNumber.type = 'text';
    inputNumber.required = true;
    const label2 = document.createElement('label');
    label2.textContent = 'Age:';
    const inputAge = document.createElement('input');
    inputAge.type = 'number';
    inputAge.min = '1';
    inputAge.required = true;
    const startBtn = document.createElement('button');
    startBtn.textContent = 'Start';
    startBtn.addEventListener('click', () => {
      const num = inputNumber.value.trim();
      const age = inputAge.value.trim();
      if (!num || !age || isNaN(parseInt(age))) {
        alert('Please enter a valid participant number and age.');
        return;
      }
      p.participant.number = num;
      p.participant.age = age;
      showInstructions();
    });
    formDiv.appendChild(label1);
    formDiv.appendChild(inputNumber);
    formDiv.appendChild(label2);
    formDiv.appendChild(inputAge);
    formDiv.appendChild(startBtn);
    container.appendChild(formDiv);
  }

  /**
   * Sequentially present the three instruction screens.  Each screen
   * waits for the participant to press the Enter key before moving on.
   * After the final screen, the main experiment trials begin.
   */
  async function showInstructions() {
    const container = document.getElementById('experiment');
    container.innerHTML = '';
    // Before showing any instructions we preload all images.  This
    // prevents network latency or caching issues from interrupting the
    // presentation of stimuli during the experiment.  Display a
    // temporary loading message while the images are being fetched.
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'loading';
    loadingDiv.textContent = 'Loading images, please wait...';
    container.appendChild(loadingDiv);
    // Await completion of the preloader.  If desired you could
    // implement a progress bar by passing a callback to preloadImages.
    await preloadImages();
    // Once preloading is complete, clear the loading message.
    container.innerHTML = '';
    // Instruction 1
    const instr1 = document.createElement('div');
    instr1.className = 'instructions';
    instr1.innerHTML = `This is a visual working memory task. This task will take approximately 30–40 minutes. You will have to remember the objects and report which one was shown in the previous set of objects as accurately as possible.<br><br>Press Enter to continue.`;
    container.appendChild(instr1);
    await waitForKey(['Enter', 'Return']);
    // Instruction 2 with image
    container.innerHTML = '';
    const instr2 = document.createElement('div');
    instr2.className = 'instructions';
    instr2.innerHTML = `First, you will briefly see a set of objects. Please remember all of the objects.`;
    const img1 = document.createElement('img');
    img1.src = 'instr1.png';
    img1.style.maxWidth = '80%';
    img1.style.height = 'auto';
    img1.style.display = 'block';
    img1.style.margin = '20px auto';
    const prompt1 = document.createElement('div');
    prompt1.textContent = 'Press Enter to continue';
    prompt1.style.marginTop = '20px';
    container.appendChild(instr2);
    container.appendChild(img1);
    container.appendChild(prompt1);
    await waitForKey(['Enter', 'Return']);
    // Instruction 3 with second image
    container.innerHTML = '';
    const instr3 = document.createElement('div');
    instr3.className = 'instructions';
    instr3.innerHTML = `Next, you will have to choose which object was shown in the previous set of objects.`;
    const img2 = document.createElement('img');
    img2.src = 'instr2.png';
    img2.style.maxWidth = '80%';
    img2.style.height = 'auto';
    img2.style.display = 'block';
    img2.style.margin = '20px auto';
    const prompt2 = document.createElement('div');
    prompt2.textContent = 'Press Enter to start the task';
    prompt2.style.marginTop = '20px';
    container.appendChild(instr3);
    container.appendChild(img2);
    container.appendChild(prompt2);
    await waitForKey(['Enter', 'Return']);
    // Start the trials
    await runTrials();
  }

  /**
   * Compute pixel positions for stimuli based on set size and randomised
   * ordering.  The returned array contains objects with CSS percentage
   * values for top and left so that elements can be positioned using
   * absolute positioning.  This uses the same relative offsets as the
   * PsychoPy script but scales them to the current viewport.
   * @param {string} ss The set size (e.g. 'size2')
   * @param {Array<number>} order Array of indices indicating the random order
   * @returns {Array<{top: string, left: string}>} Positions for each stimulus
   */
  function computePositions(ss, order) {
    const positions = [];
    const w = window.innerWidth;
    const h = window.innerHeight;
    // Define offsets in pixels based on the PsychoPy script
    const base = {
      'size2': [
        { x: -0.5 * w / 2, y: 0 },
        { x: 0.5 * w / 2, y: 0 }
      ],
      'size4': [
        { x: -0.35 * w / 2, y: 0.5 * h / 2 },
        { x: 0.35 * w / 2, y: 0.5 * h / 2 },
        { x: 0.35 * w / 2, y: -0.5 * h / 2 },
        { x: -0.35 * w / 2, y: -0.5 * h / 2 }
      ],
      'size6': [
        { x: -0.35 * w / 2, y: 0.5 * h / 2 },
        { x: 0.35 * w / 2, y: 0.5 * h / 2 },
        { x: 0.35 * w / 2, y: -0.5 * h / 2 },
        { x: -0.35 * w / 2, y: -0.5 * h / 2 },
        { x: 0.6 * w / 2, y: 0 },
        { x: -0.6 * w / 2, y: 0 }
      ]
    };
    const posArray = base[ss];
    for (let i = 0; i < order.length; i++) {
      const idx = order[i];
      const off = posArray[idx];
      const left = 50 + (off.x / w) * 100;
      const top = 50 - (off.y / h) * 100;
      positions.push({ top: `${top}%`, left: `${left}%` });
    }
    return positions;
  }

  /**
   * Compute positions for the 4AFC images.  Returns an array of CSS
   * positions matching the four quadrants defined in the original code.
   * @returns {Array<{top: string, left: string}>} Positions for the 4AFC
   */
  function computeAfcPositions() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const base = [
      { x: -0.5 * w / 2, y: 0.5 * h / 2 },
      { x: -0.5 * w / 2, y: -0.5 * h / 2 },
      { x: 0.5 * w / 2, y: 0.5 * h / 2 },
      { x: 0.5 * w / 2, y: -0.5 * h / 2 }
    ];
    return base.map(off => {
      const left = 50 + (off.x / w) * 100;
      const top = 50 - (off.y / h) * 100;
      return { top: `${top}%`, left: `${left}%` };
    });
  }

  /**
   * Run through all trials sequentially.  For each trial a fixation cross
   * is shown, then the stimuli are presented for the encoding duration,
   * followed by another fixation and then a 4AFC response screen.  Results
   * are recorded into the global `p` object.  When all trials complete
   * the finish screen is displayed.
   */
  async function runTrials() {
    const container = document.getElementById('experiment');
    // Precompute AFC positions once
    const afcPositions = computeAfcPositions();
    for (let i = 0; i < conditions.length; i++) {
      const [ss, et, ctx, cat] = conditions[i];
      const id = randId[i];
      // Store trial metadata
      p.task.trial.push(i);
      p.task.condition.push([ss, et, ctx, cat]);
      p.task.set_size.push(ss);
      p.task.encoding_time.push(et);
      p.task.context.push(ctx);
      p.task.category.push(cat);
      // Instead of storing only the numeric id for each trial, we also
      // record the actual stimulus categories used.  The stimCategory
      // variable contains the category (or categories) associated with
      // each stimulus in the current trial.  Storing this array allows
      // downstream analyses to recover which categories were presented
      // on each trial, especially in unrelated conditions where multiple
      // categories can appear.  We push a shallow copy of the array to
      // avoid unintended mutations when the original array is reused.
      p.task.id.push(stimCategory.slice());
      // Determine chosen objects and states
      let chosenObj = [];
      let chosenState = [];
      let stimCategory = [];
      if (ctx === 'related') {
        chosenObj = stimulusDict[ss].related[cat].stimulus[id].slice();
        chosenState = stimulusDict[ss].related[cat].state[id].slice();
        stimCategory = stimulusDict[ss].related[cat].category[id].slice();
      } else {
        chosenObj = stimulusDict[ss].unrelated[cat].stimulus[id].slice();
        chosenState = stimulusDict[ss].unrelated[cat].state[id].slice();
        stimCategory = stimulusDict[ss].unrelated[cat].category[id].slice();
      }
      // Save objects and states
      p.task.obj.push(chosenObj.slice());
      p.task.state.push(chosenState.slice());
      // Compute file names for each stimulus
      const stimuliPaths = [];
      for (let j = 0; j < chosenObj.length; j++) {
        const categoryName = (ctx === 'related') ? cat : stimCategory[j];
        const stim = `${categoryName}/${chosenObj[j]}_${chosenState[j]}`;
        stimuliPaths.push(stim);
      }
      // Randomise stimulus positions
      const nStim = parseInt(ss.slice(4), 10);
      const posOrder = shuffle([...Array(nStim).keys()]);
      p.task.stimulus_loc.push(posOrder.slice());
      // Compute positions
      const positions = computePositions(ss, posOrder);
      // Phase 1: fixation cross (1 second)
      container.innerHTML = '';
      const fix = document.createElement('div');
      fix.className = 'fixation';
      fix.textContent = '+';
      container.appendChild(fix);
      await sleep(1000);
      // Phase 2: show stimuli
      container.innerHTML = '';
      const stimElems = [];
      for (let j = 0; j < nStim; j++) {
        const img = document.createElement('img');
        img.className = 'stimulus-img';
        img.src = `stimuli_folder/${ss}/${stimuliPaths[j]}.jpg`;
        // Set size relative to number of stimuli
        let widthPerc = 20;
        if (ss === 'size2') widthPerc = 20;
        else if (ss === 'size4') widthPerc = 15;
        else if (ss === 'size6') widthPerc = 12;
        img.style.width = `${widthPerc}%`;
        img.style.left = positions[j].left;
        img.style.top = positions[j].top;
        img.style.transform = 'translate(-50%, -50%)';
        img.style.position = 'absolute';
        stimElems.push(img);
        container.appendChild(img);
      }
      // Show for encoding time
      await sleep(et * 1000);
      // Phase 3: fixation cross again (1 second)
      container.innerHTML = '';
      const fix2 = document.createElement('div');
      fix2.className = 'fixation';
      fix2.textContent = '+';
      container.appendChild(fix2);
      await sleep(1000);
      // Phase 4: 4AFC
      container.innerHTML = '';
      // Determine afc_cat and afc_stim pairs
      const afcCatPair = (ctx === 'related') ? stimulusDict[ss].related[cat].afc_cat[id] : stimulusDict[ss].unrelated[cat].afc_cat[id];
      const afcStimPair = (ctx === 'related') ? stimulusDict[ss].related[cat].afc_stim[id] : stimulusDict[ss].unrelated[cat].afc_stim[id];
      // Build match and foil stimuli
      const chosenState0 = chosenState[0];
      const otherState = chosenState0 === 's1' ? 's2' : 's1';
      const matchTarget = `${afcCatPair[0]}/${afcStimPair[0]}_${chosenState0}`;
      const matchObj = `${afcCatPair[0]}/${afcStimPair[0]}_${otherState}`;
      const foil1 = `${afcCatPair[1]}/${afcStimPair[1]}_s1`;
      const foil2 = `${afcCatPair[1]}/${afcStimPair[1]}_s2`;
      const afcStimuli = {
        match_target: matchTarget,
        match_obj: matchObj,
        foil_1: foil1,
        foil_2: foil2
      };
      // Randomise order while keeping pairs together
      let matchPair = ['match_target', 'match_obj'];
      let foilPair = ['foil_1', 'foil_2'];
      matchPair = shuffle(matchPair);
      foilPair = shuffle(foilPair);
      const pairs = [matchPair, foilPair];
      shuffle(pairs);
      const afcOrder = pairs.flat();
      p.task.afc_loc.push(afcOrder.slice());
      p.task.afc_cat.push(afcCatPair.slice());
      p.task.afc_stim.push(afcStimPair.slice());
      // Create 4AFC images and labels
      const keyMap = ['a', 'z', "'", '/'];
      const afcDivs = [];
      for (let pos = 0; pos < 4; pos++) {
        const stimType = afcOrder[pos];
        const stimPath = `stimuli_folder/${ss}/${afcStimuli[stimType]}.jpg`;
        // Image
        const img = document.createElement('img');
        img.className = 'afc-img';
        img.src = stimPath;
        img.style.left = afcPositions[pos].left;
        img.style.top = afcPositions[pos].top;
        img.style.transform = 'translate(-50%, -50%)';
        container.appendChild(img);
        // Key label
        const label = document.createElement('div');
        label.className = 'afc-label';
        label.textContent = `Press ${keyMap[pos]}`;
        label.style.left = afcPositions[pos].left;
        // Place label slightly below the image
        const offsetY = parseFloat(afcPositions[pos].top);
        label.style.top = `${offsetY + 6}%`;
        label.style.transform = 'translate(-50%, -50%)';
        container.appendChild(label);
        afcDivs.push({ img, label });
      }
      // Start timer for reaction time
      const startTime = performance.now();
      const allowedKeys = ['a', 'z', "'", '/'];
      const responseKey = await new Promise(resolve => {
        function handleKey(event) {
          const key = event.key;
          if (allowedKeys.includes(key)) {
            window.removeEventListener('keydown', handleKey);
            resolve(key);
          }
          if (key === 'Escape') {
            // Abort experiment
            window.removeEventListener('keydown', handleKey);
            resolve('escape');
          }
        }
        window.addEventListener('keydown', handleKey);
      });
      if (responseKey === 'escape') {
        finishExperiment(true);
        return;
      }
      const endTime = performance.now();
      const rt = (endTime - startTime) / 1000; // convert to seconds
      // Map key to position
      const keyToPos = { 'a': 0, 'z': 1, "'": 2, '/': 3 };
      const selectedPos = keyToPos[responseKey];
      const selectedStimType = afcOrder[selectedPos];
      p.task.response.push(selectedStimType);
      // Determine correctness
      if (selectedStimType === 'match_target') {
        p.task.correct_ans.push(1);
        p.task.correct_cat.push(1);
      } else if (selectedStimType === 'match_obj') {
        p.task.correct_ans.push(0);
        p.task.correct_cat.push(1);
      } else {
        p.task.correct_ans.push(0);
        p.task.correct_cat.push(0);
      }
      p.task.rt.push(rt);
      // Clear 4AFC screen briefly before next trial
      container.innerHTML = '';
    }
    // After all trials
    finishExperiment(false);
  }

  /**
   * Display a thank you message and provide a download link for the data.
   * Optionally skip the thank you if the experiment was aborted (e.g. via
   * the Escape key).
   * @param {boolean} aborted Whether the experiment ended prematurely
   */
  function finishExperiment(aborted) {
    const container = document.getElementById('experiment');
    container.innerHTML = '';
    const thank = document.createElement('div');
    thank.className = 'thank-you';
    thank.textContent = aborted ? 'Experiment aborted.' : 'Thank you for your participation!';
    container.appendChild(thank);
    // Save data and offer download if not aborted
    if (!aborted) {
      createDownloadLink(p, `${p.participant.number}_semantic_vwm.json`);
    }
  }

  // Initialise the experiment by showing the demographic form when the
  // page loads.
  window.addEventListener('load', () => {
    showDemographicForm();
  });
})();