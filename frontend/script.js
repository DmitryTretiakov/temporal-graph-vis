// Wait for the DOM to be fully loaded before running scripts
document.addEventListener("DOMContentLoaded", () => {
    console.log("DOM fully loaded and parsed");

    // --- DOM Element References ---
    const graphContainer = document.getElementById('graph-container');
    const loadingIndicator = document.getElementById('loading-indicator');
    const errorDisplay = document.getElementById('error-display');
    // Get references to the NEW slider elements and labels
    const startTimeSlider = document.getElementById('start-time-slider');
    const endTimeSlider = document.getElementById('end-time-slider');
    const startTimeLabel = document.getElementById('start-time-label');
    const endTimeLabel = document.getElementById('end-time-label');
    // const startTimeLabelDisplay = document.getElementById('start-time-label-display'); // Optional extra display
    // const endTimeLabelDisplay = document.getElementById('end-time-label-display');     // Optional extra display


    // --- Global State ---
    let sigmaInstance = null;
    let graph = null; // Graphology instance
    let overallMinTimestamp = 0;
    let overallMaxTimestamp = 0;
    // Add state to prevent slider updates during fetch
    let isFetchingData = false;

    // --- Configuration ---
    const API_ENDPOINT = '/graph-data'; // Relative path works if frontend served by Flask or same origin
    const DEBOUNCE_DELAY = 400; // Milliseconds delay for slider updates

    // --- Day.js Initialization ---
    // Extend Day.js with the UTC plugin IF you included it in index.html
    if (window.dayjs_plugin_utc) {
        dayjs.extend(window.dayjs_plugin_utc);
        console.log("Day.js UTC plugin loaded.");
    } else {
        console.warn("Day.js UTC plugin not found. Make sure it's included in index.html.");
    }

    // --- UI Helper Functions ---
    function showLoading(isLoading) {
        if (isLoading) {
            loadingIndicator.classList.remove('hidden');
            errorDisplay.classList.add('hidden'); // Hide error when loading
        } else {
            loadingIndicator.classList.add('hidden');
        }
    }

    function showError(message) {
        errorDisplay.textContent = message || "An error occurred loading graph data."; // Default message
        errorDisplay.classList.remove('hidden');
        showLoading(false); // Hide loading indicator if error occurs
    }

    function hideError() {
         errorDisplay.classList.add('hidden');
    }

    // --- Date Formatting Helper ---
    function formatTimestampUTC(timestampMs) {
        // Check for null, undefined, or NaN
        if (timestampMs === null || timestampMs === undefined || isNaN(timestampMs)) return '-';
        // Use dayjs.utc() to treat the millisecond timestamp as already being UTC
        // then format it.
        if (typeof dayjs === 'function' && dayjs.utc) {
            // Ensure it's treated as a number before passing to dayjs
            const numericTimestamp = Number(timestampMs);
            // Check again if conversion resulted in NaN
             if (isNaN(numericTimestamp)) return '-';
            return dayjs.utc(numericTimestamp).format('YYYY-MM-DD HH:mm [UTC]'); // Adjust format as needed
        } else {
            console.warn("Day.js or UTC plugin not available for formatting.");
            // Basic fallback, ensuring it's a number first
            const numericTimestamp = Number(timestampMs);
            if (isNaN(numericTimestamp)) return '-';
            try {
                return new Date(numericTimestamp).toISOString(); // Basic fallback
            } catch (e) {
                return '-'; // Handle potential errors with Date constructor
            }
        }
    }


    // --- Sigma.js Initialization ---
    function initializeSigma() {
        console.log("Initializing Sigma.js...");
        console.log("Graph container element:", graphContainer);
        try {
            // Use Graphology constructor directly
            graph = new graphology.Graph({ multi: true, type: 'directed' });

            // Use Sigma constructor directly
            sigmaInstance = new Sigma(graph, graphContainer, {
                allowInvalidContainer: true, // Useful if container dimensions change
                // Basic settings (can be customized later)
                defaultNodeType: "circle",
                defaultEdgeType: "arrow", // Use 'arrow' for directed edges
                labelDensity: 0.07,
                labelGridCellSize: 60,
                labelRenderedSizeThreshold: 15,
                labelFont: "Lato, sans-serif",
                zIndex: true, // Useful for layering elements like labels/hovers

                // Optional: Initial rendering settings
                // nodeReducer: null, // Define later for dynamic sizing/coloring
                // edgeReducer: null, // Define later for dynamic sizing/coloring
            });

            console.log("Sigma.js initialized successfully.");
            setupSigmaEventHandlers(); // Setup handlers after successful init

        } catch (e) {
            console.error("Error initializing Sigma:", e);
            showError("Failed to initialize graph visualization. Check browser console.");
            // Prevent further execution if Sigma fails
            sigmaInstance = null;
            graph = null;
        }
    }

    // --- Sigma Event Handlers (Placeholders for Phase 7) ---
    function setupSigmaEventHandlers() {
         if (!sigmaInstance) return;
         console.log("Setting up Sigma event handlers (Phase 7)...");
        // Example placeholders:
        // sigmaInstance.on('enterNode', (event) => { console.log('Enter Node:', event.node); });
        // sigmaInstance.on('leaveNode', (event) => { console.log('Leave Node:', event.node); });
        // sigmaInstance.on('clickNode', (event) => { console.log('Click Node:', event.node); });
    }

    // --- Data Fetching and Graph Population ---
    async function fetchAndPopulateGraph(startTime = null, endTime = null) {
        // Ensure Sigma and Graphology are initialized
        if (!graph || !sigmaInstance) {
            console.error("Graph or Sigma instance not initialized. Cannot fetch data.");
            showError("Initialization failed. Cannot load data.");
            return;
        }
        // Prevent concurrent fetches
        if (isFetchingData) {
            console.log("Request skipped: Already fetching data.");
            return;
        }

        console.log(`Fetching graph data for window: ${startTime} -> ${endTime}`);
        isFetchingData = true; // Set lock
        showLoading(true);
        hideError(); // Clear previous errors

        // Construct query parameters
        const params = new URLSearchParams();
        // Use stored overall timestamps only if specific ones aren't provided (initial load)
        const queryStartTime = startTime === null ? overallMinTimestamp : startTime;
        const queryEndTime = endTime === null ? overallMaxTimestamp : endTime;

        // Add parameters only if they are valid numbers (and not NaN)
        if (typeof queryStartTime === 'number' && !isNaN(queryStartTime)) {
             params.append('start_time', Math.round(queryStartTime)); // Ensure integer ms
        }
        if (typeof queryEndTime === 'number' && !isNaN(queryEndTime)) {
             params.append('end_time', Math.round(queryEndTime)); // Ensure integer ms
        }

        const url = `${API_ENDPOINT}?${params.toString()}`;
        console.log(`Requesting URL: ${url}`); // Log the actual URL being requested

        try {
            const response = await fetch(url);

            if (!response.ok) {
                // Try to parse error JSON from backend, provide fallback
                const errorData = await response.json().catch(() => ({ error: `Server responded with status ${response.status}` }));
                throw new Error(`HTTP error ${response.status}: ${errorData.error || response.statusText}`);
            }

            const data = await response.json();
            console.log("Data received from backend:", data);

            // --- Populate Graphology ---
            graph.clear(); // Clear previous data efficiently

            // Add nodes
            data.nodes.forEach(node => {
                if (!graph.hasNode(node.id)) {
                     graph.addNode(node.id, {
                        label: node.label, // Use label from data
                        // Initial random position - layout algorithm will fix this later
                        x: Math.random() * 100,
                        y: Math.random() * 100,
                        // Size based on degree (adjust scaling factor as needed)
                        size: Math.max(3, Math.sqrt(node.degree || 1) * 2), // Min size 3, scale by sqrt(degree)
                        degree: node.degree || 0, // Store degree for potential use (tooltips)
                        color: getRandomColor() // Assign a random color for now (Phase 7 will improve)
                    });
                } else {
                    // If node exists from a previous wider range, update its attributes
                    graph.setNodeAttribute(node.id, 'degree', node.degree || 0);
                    graph.setNodeAttribute(node.id, 'size', Math.max(3, Math.sqrt(node.degree || 1) * 2));
                    // Note: Existing nodes outside the new time window won't be in data.nodes
                    // and thus won't be updated here. graph.clear() handles removal.
                }
            });

            // Add edges
            let edgeCount = 0;
            data.links.forEach(link => {
                try {
                    // Ensure source and target nodes exist in the *current* graph state
                    if (graph.hasNode(link.source) && graph.hasNode(link.target)) {
                         // Add edge (Graphology handles multi-graph if initialized)
                         // Consider adding a unique key if needed, but source/target/timestamp might suffice
                         graph.addEdge(link.source, link.target, {
                            timestamp: link.timestamp,
                            type: 'arrow', // Ensure Sigma renders it as directed
                            size: 1, // Default edge size (can be styled later)
                            color: '#ccc' // Default edge color (can be styled later)
                        });
                        edgeCount++;
                    } else {
                        // This can happen if a node involved in the link had 0 degree
                        // within the window and wasn't included in data.nodes
                        console.warn(`Skipping edge: Node missing for link ${link.source} -> ${link.target}. This might be expected if a node has no connections *within* this specific window.`);
                    }
                } catch (e) {
                    // Catch other errors during edge addition
                    console.error(`Error adding edge ${link.source} -> ${link.target}:`, e);
                }
            });

            console.log(`Graph populated: ${graph.order} nodes, ${graph.size} edges (added ${edgeCount} based on links data).`);

            // **** INITIALIZE SLIDERS (ONLY ON FIRST LOAD) ****
            if (startTime === null && endTime === null) {
                console.log("Performing initial slider setup...");
                // Store overall timestamps from the response
                overallMinTimestamp = data.min_timestamp;
                overallMaxTimestamp = data.max_timestamp;
                console.log(`Overall time range received: ${overallMinTimestamp} -> ${overallMaxTimestamp}`);

                // Validate timestamps before setting sliders
                const minTsIsValid = typeof overallMinTimestamp === 'number' && !isNaN(overallMinTimestamp);
                const maxTsIsValid = typeof overallMaxTimestamp === 'number' && !isNaN(overallMaxTimestamp);

                if (minTsIsValid && maxTsIsValid && overallMinTimestamp <= overallMaxTimestamp) {
                    // Set slider min/max attributes (use strings for HTML attributes)
                    startTimeSlider.min = String(overallMinTimestamp);
                    startTimeSlider.max = String(overallMaxTimestamp);
                    endTimeSlider.min = String(overallMinTimestamp);
                    endTimeSlider.max = String(overallMaxTimestamp);

                    // Set initial slider values (use strings for HTML attributes)
                    startTimeSlider.value = String(overallMinTimestamp);
                    endTimeSlider.value = String(overallMaxTimestamp);

                    // Update labels with initial formatted values
                    startTimeLabel.textContent = formatTimestampUTC(overallMinTimestamp);
                    endTimeLabel.textContent = formatTimestampUTC(overallMaxTimestamp);
                    // Update optional display labels too
                    // startTimeLabelDisplay.textContent = formatTimestampUTC(overallMinTimestamp);
                    // endTimeLabelDisplay.textContent = formatTimestampUTC(overallMaxTimestamp);

                    // Enable sliders if they were disabled
                    startTimeSlider.disabled = false;
                    endTimeSlider.disabled = false;
                    console.log("Sliders initialized and enabled.");

                } else {
                     console.error("Invalid or inconsistent overall timestamps received from backend:", data.min_timestamp, data.max_timestamp);
                     showError("Error: Invalid time range received from server. Cannot initialize sliders.");
                     // Disable sliders as they cannot be set up correctly
                     startTimeSlider.disabled = true;
                     endTimeSlider.disabled = true;
                }
            }

            // Apply layout (Placeholder for Phase 7)
            // applyLayout();

            // Sigma v2 usually refreshes automatically when Graphology changes.
            // If needed, manual refresh: sigmaInstance.refresh();

        } catch (error) {
            console.error("Failed to fetch or process graph data:", error);
            // Display the specific error message from the catch block
            showError(`Failed to load graph data: ${error.message}`);
            graph.clear(); // Clear graph on error to avoid showing stale data
        } finally {
            showLoading(false); // Hide loading indicator
            isFetchingData = false; // Release lock
        }
    }

    // --- Helper for random colors (temporary for node visualization) ---
    function getRandomColor() {
        const letters = '0123456789ABCDEF';
        let color = '#';
        for (let i = 0; i < 6; i++) {
            color += letters[Math.floor(Math.random() * 16)];
        }
        return color;
    }

    // --- Layout Function (Placeholder for Phase 7) ---
    function applyLayout() {
        if (!graph || !sigmaInstance) return;
        console.log("Applying layout (Phase 7 placeholder)...");
        // Layout logic using ForceAtlas2 or other algorithms will go here.
        // Example (requires installing graphology-layout-forceatlas2):
        // import forceAtlas2 from 'graphology-layout-forceatlas2';
        // const settings = { iterations: 50, barnesHutOptimize: true };
        // forceAtlas2.assign(graph, settings);
    }


    // **** PHASE 6 - STEP 4: Implement Debouncing ****
    function debounce(func, delay) {
        let timeoutId;
        return function(...args) {
            // Store the context (`this`) and arguments
            const context = this;
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                // Only call func if not currently fetching data
                if (!isFetchingData) {
                    func.apply(context, args); // Use apply to preserve context and arguments
                } else {
                    console.log("Debounced call skipped: data fetch in progress.");
                }
            }, delay);
        };
    }

    // **** PHASE 6 - STEP 5: Handle Slider Events ****

    // Function to be called when sliders change (will be debounced)
    function handleTimeChange() {
        // Read current values from sliders as numbers
        let startTimeMs = parseInt(startTimeSlider.value, 10);
        let endTimeMs = parseInt(endTimeSlider.value, 10);

        // Ensure values are numbers, default if not (shouldn't happen with range inputs)
        startTimeMs = isNaN(startTimeMs) ? overallMinTimestamp : startTimeMs;
        endTimeMs = isNaN(endTimeMs) ? overallMaxTimestamp : endTimeMs;

        // Basic handling if sliders cross over - prevent start > end
        // This logic forces the sliders not to cross.
        // 'this' refers to the slider element that triggered the 'input' event
        if (this === startTimeSlider && startTimeMs > endTimeMs) {
            // If start slider moved past end slider, set end slider to match start slider
            endTimeSlider.value = String(startTimeMs); // Update the other slider's value
            endTimeMs = startTimeMs; // Update the value used for fetching
            console.warn("Start time adjusted to match end time (sliders crossed).");
        } else if (this === endTimeSlider && endTimeMs < startTimeMs) {
            // If end slider moved before start slider, set start slider to match end slider
            startTimeSlider.value = String(endTimeMs); // Update the other slider's value
            startTimeMs = endTimeMs; // Update the value used for fetching
            console.warn("End time adjusted to match start time (sliders crossed).");
        }

        // Update UI Labels immediately with potentially adjusted values
        startTimeLabel.textContent = formatTimestampUTC(startTimeMs);
        endTimeLabel.textContent = formatTimestampUTC(endTimeMs);
        // Update optional display labels too
        // startTimeLabelDisplay.textContent = formatTimestampUTC(startTimeMs);
        // endTimeLabelDisplay.textContent = formatTimestampUTC(endTimeMs);


        // Fetch new graph data for the selected range (using the potentially adjusted times)
        // The actual API call is debounced below. This function just prepares the values.
        // We pass the adjusted values to the debounced function which then calls fetch.
         // Note: The debounced function will call fetchAndPopulateGraph
         // We don't call it directly here anymore.
    }

     // Create the debounced version of the handler function
     // This debounced function will eventually call fetchAndPopulateGraph
     const debouncedFetchUpdate = debounce(() => {
         // Read the LATEST values from sliders when the debounce timer fires
         let currentStartTimeMs = parseInt(startTimeSlider.value, 10);
         let currentEndTimeMs = parseInt(endTimeSlider.value, 10);

         // Final validation before fetching
         currentStartTimeMs = isNaN(currentStartTimeMs) ? overallMinTimestamp : currentStartTimeMs;
         currentEndTimeMs = isNaN(currentEndTimeMs) ? overallMaxTimestamp : currentEndTimeMs;
         if (currentStartTimeMs > currentEndTimeMs) {
             // If they are still crossed somehow, force start = end
             currentStartTimeMs = currentEndTimeMs;
         }

         fetchAndPopulateGraph(currentStartTimeMs, currentEndTimeMs);
     }, DEBOUNCE_DELAY);


    // Add event listeners to sliders
    // Use 'input' event to trigger UI label updates immediately while dragging
    startTimeSlider.addEventListener('input', handleTimeChange); // Update labels immediately
    endTimeSlider.addEventListener('input', handleTimeChange);   // Update labels immediately

    // Use the 'input' event ALSO to trigger the debounced *fetch*
    startTimeSlider.addEventListener('input', debouncedFetchUpdate); // Trigger debounced fetch
    endTimeSlider.addEventListener('input', debouncedFetchUpdate);   // Trigger debounced fetch


    // --- Main Execution ---
    initializeSigma(); // Initialize Sigma and Graphology first

    // Fetch initial data only if initialization was successful
    if (sigmaInstance && graph) {
        fetchAndPopulateGraph(); // Initial load for the full time range
    } else {
         console.error("Skipping initial data fetch because Sigma/Graphology failed to initialize.");
         showError("Graph visualization could not be initialized. Cannot load data.");
         // Disable sliders if init failed
         startTimeSlider.disabled = true;
         endTimeSlider.disabled = true;
    }

}); // End of DOMContentLoaded listener