// Wait for the DOM to be fully loaded before running scripts
document.addEventListener("DOMContentLoaded", () => {
    console.log("DOM fully loaded and parsed");

    // --- DOM Element References ---
    const graphContainer = document.getElementById('graph-container');
    const loadingIndicator = document.getElementById('loading-indicator');
    const errorDisplay = document.getElementById('error-display');
    const startTimeSlider = document.getElementById('start-time-slider');
    const endTimeSlider = document.getElementById('end-time-slider');
    const startTimeLabel = document.getElementById('start-time-label');
    const endTimeLabel = document.getElementById('end-time-label');

    // --- Global State ---
    let sigmaInstance = null;
    let graph = null; // Graphology instance
    let overallMinTimestamp = 0;
    let overallMaxTimestamp = 0;
    let isFetchingData = false;
    let isDragging = false;
    let draggedNode = null;
    let dragStartX = 0;
    let dragStartY = 0;
    // --- NEW: Flag for initial zoom ---
    let initialZoomApplied = false;

    // --- Configuration ---
    const API_ENDPOINT = '/graph-data';
    const DEBOUNCE_DELAY = 400;

    // --- Day.js Initialization ---
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
            errorDisplay.classList.add('hidden');
        } else {
            loadingIndicator.classList.add('hidden');
        }
    }

    function showError(message) {
        errorDisplay.textContent = message || "An error occurred loading graph data.";
        errorDisplay.classList.remove('hidden');
        showLoading(false);
    }

    function hideError() {
         errorDisplay.classList.add('hidden');
    }

    // --- Date Formatting Helper ---
    function formatTimestampUTC(timestampMs) {
        if (timestampMs === null || timestampMs === undefined || isNaN(timestampMs)) return '-';
        if (typeof dayjs === 'function' && dayjs.utc) {
            const numericTimestamp = Number(timestampMs);
            if (isNaN(numericTimestamp)) return '-';
            return dayjs.utc(numericTimestamp).format('YYYY-MM-DD HH:mm [UTC]');
        } else {
            console.warn("Day.js or UTC plugin not available for formatting.");
            const numericTimestamp = Number(timestampMs);
            if (isNaN(numericTimestamp)) return '-';
            try {
                return new Date(numericTimestamp).toISOString();
            } catch (e) {
                return '-';
            }
        }
    }

    // --- Sigma.js Initialization ---
    function initializeSigma() {
        console.log("Initializing Sigma.js...");
        try {
            graph = new graphology.Graph({ multi: true, type: 'directed' });

            sigmaInstance = new Sigma(graph, graphContainer, {
                allowInvalidContainer: true,
                defaultNodeType: "circle",
                defaultEdgeType: "arrow",
                labelDensity: 0.07,
                labelGridCellSize: 60,
                labelRenderedSizeThreshold: 15,
                labelFont: "Lato, sans-serif",
                zIndex: true,
            });

            console.log("Sigma.js initialized successfully.");
            setupSigmaEventHandlers(); // Setup handlers after successful init

        } catch (e) {
            console.error("Error initializing Sigma:", e);
            showError("Failed to initialize graph visualization. Check browser console.");
            sigmaInstance = null;
            graph = null;
        }
    }

// --- Sigma Event Handlers ---
function setupSigmaEventHandlers() {
    if (!sigmaInstance) return;
    console.log("Setting up Sigma event handlers...");

    // --- Node Dragging Logic ---
   sigmaInstance.on("downNode", (e) => {
       isDragging = true;
       draggedNode = e.node;
       // ... (calculate dragStartX/Y) ...
       const nodePosition = sigmaInstance.graphToViewport(graph.getNodeAttributes(draggedNode));
       const mousePosition = { x: e.event.x, y: e.event.y };
       dragStartX = mousePosition.x - nodePosition.x;
       dragStartY = mousePosition.y - nodePosition.y;
       console.log("Start dragging node:", draggedNode);
       sigmaInstance.getCamera().disable();
   });

   sigmaInstance.getMouseCaptor().on("mousemove", (e) => {
       // ... (keep existing mousemove logic to update node x/y) ...
       if (!isDragging || !draggedNode) return;
       const mousePosition = { x: e.x, y: e.y };
       const newViewportPos = { x: mousePosition.x - dragStartX, y: mousePosition.y - dragStartY };
       const newGraphPos = sigmaInstance.viewportToGraph(newViewportPos);
       graph.setNodeAttribute(draggedNode, "x", newGraphPos.x);
       graph.setNodeAttribute(draggedNode, "y", newGraphPos.y);
   });

   sigmaInstance.getMouseCaptor().on("mouseup", () => {
       if (isDragging && draggedNode) {
           console.log("End dragging node:", draggedNode);
           // --- NEW: Trigger layout with FEWER iterations ---
           applyLayout(20); // Run only 20 iterations for a quick adjustment
       }
       isDragging = false;
       draggedNode = null;
       sigmaInstance.getCamera().enable();
   });

   sigmaInstance.getMouseCaptor().on("mouseleave", () => {
        if (isDragging && draggedNode) {
           console.log("End dragging node (mouseleave):", draggedNode);
            // --- NEW: Trigger layout with FEWER iterations ---
           applyLayout(20); // Run only 20 iterations for a quick adjustment
        }
       isDragging = false;
       draggedNode = null;
       sigmaInstance.getCamera().enable();
   });

   // ... (Hover/Click handlers later) ...
}

    // --- Data Fetching and Graph Population ---
    async function fetchAndPopulateGraph(startTime = null, endTime = null) {
        if (!graph || !sigmaInstance) {
            console.error("Graph or Sigma instance not initialized. Cannot fetch data.");
            showError("Initialization failed. Cannot load data.");
            return;
        }
        if (isFetchingData) {
            console.log("Request skipped: Already fetching data.");
            return;
        }

        console.log(`Fetching graph data for window: ${startTime} -> ${endTime}`);
        isFetchingData = true;
        showLoading(true);
        hideError();

        const params = new URLSearchParams();
        const queryStartTime = startTime === null ? overallMinTimestamp : startTime;
        const queryEndTime = endTime === null ? overallMaxTimestamp : endTime;

        if (typeof queryStartTime === 'number' && !isNaN(queryStartTime)) {
             params.append('start_time', Math.round(queryStartTime));
        }
        if (typeof queryEndTime === 'number' && !isNaN(queryEndTime)) {
             params.append('end_time', Math.round(queryEndTime));
        }

        const url = `${API_ENDPOINT}?${params.toString()}`;
        console.log(`Requesting URL: ${url}`);

        try {
            const response = await fetch(url);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: `Server responded with status ${response.status}` }));
                throw new Error(`HTTP error ${response.status}: ${errorData.error || response.statusText}`);
            }
            const data = await response.json();
            console.log("Data received from backend:", data);

            graph.clear();

            data.nodes.forEach(node => {
                if (!graph.hasNode(node.id)) {
                     graph.addNode(node.id, {
                        label: node.label,
                        x: Math.random() * 100,
                        y: Math.random() * 100,
                        size: Math.max(3, Math.sqrt(node.degree || 1) * 2),
                        degree: node.degree || 0,
                        color: getRandomColor()
                    });
                } else {
                    graph.setNodeAttribute(node.id, 'degree', node.degree || 0);
                    graph.setNodeAttribute(node.id, 'size', Math.max(3, Math.sqrt(node.degree || 1) * 2));
                }
            });

            let edgeCount = 0;
            data.links.forEach(link => {
                try {
                    if (graph.hasNode(link.source) && graph.hasNode(link.target)) {
                         graph.addEdge(link.source, link.target, {
                            timestamp: link.timestamp,
                            type: 'arrow',
                            size: 1,
                            color: '#ccc'
                        });
                        edgeCount++;
                    } else {
                        console.warn(`Skipping edge: Node missing for link ${link.source} -> ${link.target}.`);
                    }
                } catch (e) {
                    console.error(`Error adding edge ${link.source} -> ${link.target}:`, e);
                }
            });
            console.log(`Graph populated: ${graph.order} nodes, ${graph.size} edges (added ${edgeCount} based on links data).`);

            // **** INITIALIZE SLIDERS (ONLY ON FIRST LOAD) ****
            if (startTime === null && endTime === null) {
                console.log("Performing initial slider setup...");
                overallMinTimestamp = data.min_timestamp;
                overallMaxTimestamp = data.max_timestamp;
                console.log(`Overall time range received: ${overallMinTimestamp} -> ${overallMaxTimestamp}`);
                const minTsIsValid = typeof overallMinTimestamp === 'number' && !isNaN(overallMinTimestamp);
                const maxTsIsValid = typeof overallMaxTimestamp === 'number' && !isNaN(overallMaxTimestamp);

                if (minTsIsValid && maxTsIsValid && overallMinTimestamp <= overallMaxTimestamp) {
                    startTimeSlider.min = String(overallMinTimestamp);
                    startTimeSlider.max = String(overallMaxTimestamp);
                    endTimeSlider.min = String(overallMinTimestamp);
                    endTimeSlider.max = String(overallMaxTimestamp);
                    startTimeSlider.value = String(overallMinTimestamp);
                    endTimeSlider.value = String(overallMaxTimestamp);
                    startTimeLabel.textContent = formatTimestampUTC(overallMinTimestamp);
                    endTimeLabel.textContent = formatTimestampUTC(overallMaxTimestamp);
                    startTimeSlider.disabled = false;
                    endTimeSlider.disabled = false;
                    console.log("Sliders initialized and enabled.");
                } else {
                     console.error("Invalid or inconsistent overall timestamps received from backend:", data.min_timestamp, data.max_timestamp);
                     showError("Error: Invalid time range received from server. Cannot initialize sliders.");
                     startTimeSlider.disabled = true;
                     endTimeSlider.disabled = true;
                }
            }

            // Apply layout
            applyLayout(); // Call layout after populating

        } catch (error) {
            console.error("Failed to fetch or process graph data:", error);
            showError(`Failed to load graph data: ${error.message}`);
            graph.clear();
        } finally {
            showLoading(false);
            isFetchingData = false;
        }
    }

    // --- Helper for random colors ---
    function getRandomColor() {
        const letters = '0123456789ABCDEF';
        let color = '#';
        for (let i = 0; i < 6; i++) {
            color += letters[Math.floor(Math.random() * 16)];
        }
        return color;
    }

// --- Layout Function ---
function applyLayout(iterationsOverride) { // Accept optional override
    if (!graph || !sigmaInstance || graph.order === 0) {
        console.log("Skipping layout: Graph empty or not initialized.");
        return;
    }
    const layoutIterations = iterationsOverride !== undefined ? iterationsOverride : 100; // Use override or default
    console.log(`Applying ForceAtlas2 layout (${layoutIterations} iterations)...`);


    if (typeof graphologyLayoutForceatlas2 === 'undefined') {
        console.error("graphologyLayoutForceatlas2 is not loaded.");
        return;
    }

    // --- Adjusted ForceAtlas2 Settings ---
    const settings = {
        iterations: layoutIterations, // Use the determined iteration count
        settings: {
            barnesHutOptimize: graph.order > 1000,
            gravity: 0.8,
            scalingRatio: 35,      // INCREASED FURTHER - Experiment needed (try 30, 40, 50)
            strongGravityMode: true,
        }
    };
    // ---

    try {
        // Run the layout
        graphologyLayoutForceatlas2.assign(graph, settings);
        console.log("ForceAtlas2 layout applied.");

        // Apply initial camera centering and zoom-out ONCE
        if (!initialZoomApplied && graph.order > 0) {
            console.log("Applying initial camera centering and zoom out...");

            // Calculate graph center
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            graph.forEachNode((node, attributes) => {
                if (attributes.x < minX) minX = attributes.x;
                if (attributes.x > maxX) maxX = attributes.x;
                if (attributes.y < minY) minY = attributes.y;
                if (attributes.y > maxY) maxY = attributes.y;
            });

            let centerX = 0;
            let centerY = 0;
            if (minX !== Infinity) { // Check if nodes exist
                centerX = (minX + maxX) / 2;
                centerY = (minY + maxY) / 2;
            }

            const targetRatio = 0.8; // Keep initial zoom factor (adjust if needed)
            console.log(`Centering camera on [${centerX.toFixed(2)}, ${centerY.toFixed(2)}] with ratio ${targetRatio}`);

            sigmaInstance.getCamera().setState({ // Use setState for immediate effect or animate
                 x: centerX,
                 y: centerY,
                 ratio: targetRatio,
                 angle: 0 // Ensure angle is reset
            });
            // OR Animate:
            sigmaInstance.getCamera().animate(
                { x: centerX, y: centerY, ratio: targetRatio },
                { duration: 600 }
            );

            initialZoomApplied = true; // Set flag so it doesn't run again
        }

    } catch (e) {
        console.error("Error applying ForceAtlas2 layout:", e);
    }
}

    // --- Debounce Function ---
    function debounce(func, delay) {
        let timeoutId;
        return function(...args) {
            const context = this;
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                if (!isFetchingData) {
                    func.apply(context, args);
                } else {
                    console.log("Debounced call skipped: data fetch in progress.");
                }
            }, delay);
        };
    }

    // --- Handle Slider Events ---
    function handleTimeChange() {
        let startTimeMs = parseInt(startTimeSlider.value, 10);
        let endTimeMs = parseInt(endTimeSlider.value, 10);
        startTimeMs = isNaN(startTimeMs) ? overallMinTimestamp : startTimeMs;
        endTimeMs = isNaN(endTimeMs) ? overallMaxTimestamp : endTimeMs;

        if (this === startTimeSlider && startTimeMs > endTimeMs) {
            endTimeSlider.value = String(startTimeMs);
            endTimeMs = startTimeMs;
            console.warn("Start time adjusted to match end time (sliders crossed).");
        } else if (this === endTimeSlider && endTimeMs < startTimeMs) {
            startTimeSlider.value = String(endTimeMs);
            startTimeMs = endTimeMs;
            console.warn("End time adjusted to match start time (sliders crossed).");
        }

        startTimeLabel.textContent = formatTimestampUTC(startTimeMs);
        endTimeLabel.textContent = formatTimestampUTC(endTimeMs);
    }

    const debouncedFetchUpdate = debounce(() => {
        let currentStartTimeMs = parseInt(startTimeSlider.value, 10);
        let currentEndTimeMs = parseInt(endTimeSlider.value, 10);
        currentStartTimeMs = isNaN(currentStartTimeMs) ? overallMinTimestamp : currentStartTimeMs;
        currentEndTimeMs = isNaN(currentEndTimeMs) ? overallMaxTimestamp : currentEndTimeMs;
        if (currentStartTimeMs > currentEndTimeMs) {
            currentStartTimeMs = currentEndTimeMs;
        }
        fetchAndPopulateGraph(currentStartTimeMs, currentEndTimeMs);
    }, DEBOUNCE_DELAY);

    startTimeSlider.addEventListener('input', handleTimeChange);
    endTimeSlider.addEventListener('input', handleTimeChange);
    startTimeSlider.addEventListener('input', debouncedFetchUpdate);
    endTimeSlider.addEventListener('input', debouncedFetchUpdate);

    // --- Main Execution ---
    initializeSigma();
    if (sigmaInstance && graph) {
        fetchAndPopulateGraph(); // Initial load
    } else {
         console.error("Skipping initial data fetch because Sigma/Graphology failed to initialize.");
         showError("Graph visualization could not be initialized. Cannot load data.");
         startTimeSlider.disabled = true;
         endTimeSlider.disabled = true;
    }

}); // End of DOMContentLoaded listener