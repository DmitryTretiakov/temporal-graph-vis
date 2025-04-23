// frontend/script.js (Bundled Version)

// --- ES Module Imports ---
import Graph from 'graphology';
import Sigma from 'sigma';
// Import the default export from the layout library
import forceAtlas2Layout from 'graphology-layout-forceatlas2';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc'; // Import UTC plugin

// --- Initialize Plugins ---
dayjs.extend(utc); // Apply the UTC plugin to dayjs

// --- Wait for the DOM to be fully loaded before running scripts ---
document.addEventListener("DOMContentLoaded", () => {
    console.log("DOM fully loaded and parsed (Bundled Version)");

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
    let initialZoomApplied = false;

    // --- Configuration ---
    const API_ENDPOINT = '/graph-data';
    const DEBOUNCE_DELAY = 400; // Delay for slider updates triggering fetch
    // Layout iterations for initial load (tune based on performance vs quality)
    const INITIAL_LAYOUT_ITERATIONS = 50; // Lower for faster initial load on large graphs
    // Layout iterations after drag (minimal adjustment)
    const DRAG_END_LAYOUT_ITERATIONS = 5; // Quick adjustment after drag

    // --- Day.js Initialization (already done via import/extend) ---
    console.log("Day.js initialized with UTC plugin.");

    // --- UI Helper Functions ---
    function showLoading(isLoading) {
        loadingIndicator.classList.toggle('hidden', !isLoading);
        if (isLoading) errorDisplay.classList.add('hidden'); // Hide error when loading
    }

    function showError(message) {
        errorDisplay.textContent = message || "An error occurred.";
        errorDisplay.classList.remove('hidden');
        showLoading(false); // Hide loading when error shows
    }

    function hideError() {
         errorDisplay.classList.add('hidden');
    }

    // --- Date Formatting Helper ---
     function formatTimestampUTC(timestampMs) {
        if (timestampMs === null || timestampMs === undefined || isNaN(timestampMs)) return '-';
        if (typeof dayjs === 'function') {
            const numericTimestamp = Number(timestampMs);
            if (isNaN(numericTimestamp)) return '-';
            return dayjs.utc(numericTimestamp).format('YYYY-MM-DD HH:mm [UTC]');
        } else {
            console.warn("Day.js not available for formatting."); // Should not happen
            const numericTimestamp = Number(timestampMs);
             if (isNaN(numericTimestamp)) return '-';
            try { return new Date(numericTimestamp).toISOString(); } catch (e) { return '-'; }
        }
    }

    // --- Sigma.js Initialization ---
    function initializeSigma() {
        console.log("Initializing Sigma.js...");
        try {
            graph = new Graph({ multi: true, type: 'directed' });

            sigmaInstance = new Sigma(graph, graphContainer, {
                allowInvalidContainer: true, // Should not be needed if container is sized
                defaultNodeType: "circle",
                defaultEdgeType: "arrow",
                // Performance & Readability settings for large graphs:
                labelDensity: 0.1, // Show fewer labels overall
                labelGridCellSize: 150, // Increase space required between labels
                labelRenderedSizeThreshold: 12, // Only render labels for nodes visually larger than this
                labelFont: "Lato, sans-serif",
                zIndex: true, // Enable z-index for layering
                hideEdgesOnMove: true, // Hide edges while panning/zooming
                hideLabelsOnMove: true, // Hide labels while panning/zooming
                mouseEnabled: true,
                 settings: {
                    enableCameraInteraction: true // Allow zoom/pan
                }
            });

            console.log("Sigma.js initialized successfully.");
            setupSigmaEventHandlers();

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

        // --- Node Dragging Logic (No dynamic layout during drag) ---
        sigmaInstance.on("downNode", (e) => {
            isDragging = true;
            draggedNode = e.node;
            const initialGraphPos = graph.getNodeAttributes(draggedNode);
            const nodePosition = sigmaInstance.graphToViewport(initialGraphPos);
            const mousePosition = { x: e.event.x, y: e.event.y };
            dragStartX = mousePosition.x - nodePosition.x;
            dragStartY = mousePosition.y - nodePosition.y;
            console.log("Start dragging node:", draggedNode);
            sigmaInstance.getCamera().disable();
        });

        sigmaInstance.getMouseCaptor().on("mousemove", (e) => {
            if (!isDragging || !draggedNode) return;
            const mousePosition = { x: e.x, y: e.y };
            const newViewportPos = { x: mousePosition.x - dragStartX, y: mousePosition.y - dragStartY };
            const newGraphPos = sigmaInstance.viewportToGraph(newViewportPos);
            // Update graph data directly - Sigma will re-render the node
            graph.setNodeAttribute(draggedNode, "x", newGraphPos.x);
            graph.setNodeAttribute(draggedNode, "y", newGraphPos.y);
        });

        const stopDragging = () => {
            if (isDragging && draggedNode) {
                console.log("End dragging node:", draggedNode);
                 // Run a FEW layout iterations AFTER drag ends for minor adjustment
                 console.log(`Applying ${DRAG_END_LAYOUT_ITERATIONS} layout iterations post-drag...`);
                 applyLayout(DRAG_END_LAYOUT_ITERATIONS);
            }
            isDragging = false;
            draggedNode = null;
            if (sigmaInstance) {
                 sigmaInstance.getCamera().enable();
            }
        };

        sigmaInstance.getMouseCaptor().on("mouseup", stopDragging);
        sigmaInstance.getMouseCaptor().on("mouseleave", stopDragging); // Stop if mouse leaves canvas

        // --- Hover Handlers (Optional: Can impact performance on very large graphs) ---
        // sigmaInstance.on("enterNode", (e) => { /* Add tooltip logic if needed */ });
        // sigmaInstance.on("leaveNode", (e) => { /* Hide tooltip logic if needed */ });
    }

    // --- Data Fetching and Graph Population ---
    async function fetchAndPopulateGraph(startTime = null, endTime = null) {
        if (!graph || !sigmaInstance) {
            console.error("Graph or Sigma instance not initialized.");
            showError("Initialization failed. Cannot load data.");
            return;
        }
        if (isFetchingData) {
            console.log("Request skipped: Already fetching data.");
            return;
        }

        initialZoomApplied = false; // Reset zoom flag for new data

        console.log(`Fetching graph data for window: ${startTime} -> ${endTime}`);
        isFetchingData = true;
        showLoading(true);
        hideError();

        const params = new URLSearchParams();
        const queryStartTime = startTime === null ? overallMinTimestamp : startTime;
        const queryEndTime = endTime === null ? overallMaxTimestamp : endTime;

        // Ensure valid numbers before appending
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
                const errorText = await response.text();
                throw new Error(`HTTP error ${response.status}: ${errorText}`);
            }
            const data = await response.json();
            console.log(`Data received: ${data.nodes?.length || 0} nodes, ${data.links?.length || 0} links`);

            if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.links)) {
                throw new Error("Invalid data structure received from backend.");
            }

            // Preserve existing node positions if possible
            const existingNodes = {};
            if (graph.order > 0) {
                graph.forEachNode((node, attrs) => {
                    existingNodes[node] = { x: attrs.x, y: attrs.y };
                });
            }
            graph.clear(); // Clear previous graph data

            console.log("Populating graph...");
            let nodesAdded = 0;
            data.nodes.forEach(node => {
                if (node.id === null || node.id === undefined) {
                    console.warn("Skipping node with null/undefined ID:", node); return;
                }
                const nodeExists = graph.hasNode(node.id); // Should always be false after clear()
                if (!nodeExists) {
                     const existingPos = existingNodes[node.id];
                     graph.addNode(node.id, {
                        label: node.label || node.id,
                        x: existingPos?.x ?? Math.random() * 1000, // Use existing or random
                        y: existingPos?.y ?? Math.random() * 1000,
                        size: Math.max(1.5, Math.sqrt(node.degree || 1) * 0.6), // Adjust size scaling
                        degree: node.degree || 0,
                        color: getRandomColor()
                    });
                    nodesAdded++;
                }
            });

            let edgesAdded = 0;
            data.links.forEach(link => {
                 if (link.source === null || link.source === undefined || link.target === null || link.target === undefined) {
                     console.warn("Skipping link with null/undefined source/target:", link); return;
                 }
                try {
                    // Only add edges if both source and target nodes were successfully added
                    if (graph.hasNode(link.source) && graph.hasNode(link.target)) {
                         const edgeKey = `${link.source}|${link.target}|${link.timestamp}`; // Use a robust key
                         if (!graph.hasEdge(edgeKey)) {
                            graph.addEdgeWithKey(edgeKey, link.source, link.target, {
                                timestamp: link.timestamp,
                                type: 'arrow',
                                size: 0.5, // Keep edges thin
                                color: '#ccc'
                            });
                            edgesAdded++;
                         }
                    }
                } catch (e) {
                     // Catch potential errors during edge addition
                     if (!e.message || !e.message.includes("already exists")) { // Ignore duplicate edge errors if keying works
                         console.error(`Error adding edge ${link.source} -> ${link.target}:`, e);
                     }
                }
            });
            console.log(`Graph populated: ${nodesAdded} nodes, ${edgesAdded} edges.`);
            if (graph.order === 0) {
                 console.warn("Graph is empty after population.");
                 // Optionally show a message to the user
            }

            // Initialize sliders (only on first full load)
            if (startTime === null && endTime === null) {
                console.log("Performing initial slider setup...");
                overallMinTimestamp = data.min_timestamp;
                overallMaxTimestamp = data.max_timestamp;
                 const now = Date.now();
                 if (overallMinTimestamp === null || overallMinTimestamp === undefined || isNaN(overallMinTimestamp)) {
                    overallMinTimestamp = now - 3600 * 1000 * 24 * 7; // Default: 1 week ago
                    console.warn("Using default min timestamp");
                 }
                 if (overallMaxTimestamp === null || overallMaxTimestamp === undefined || isNaN(overallMaxTimestamp) || overallMaxTimestamp < overallMinTimestamp) {
                    overallMaxTimestamp = now; // Default: now
                    console.warn("Using default max timestamp");
                 }
                console.log(`Overall time range: ${overallMinTimestamp} -> ${overallMaxTimestamp}`);

                if (overallMinTimestamp <= overallMaxTimestamp) {
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
                     console.error("Invalid overall timestamps after defaults:", overallMinTimestamp, overallMaxTimestamp);
                     showError("Error: Invalid time range. Cannot initialize sliders.");
                     startTimeSlider.disabled = true;
                     endTimeSlider.disabled = true;
                }
            }

            // Apply layout only if the graph has nodes
            if (graph.order > 0) {
                console.log("Triggering layout calculation...");
                applyLayout(INITIAL_LAYOUT_ITERATIONS);
            } else {
                 showLoading(false); // Hide loading if graph is empty
            }

        } catch (error) {
            console.error("Failed to fetch or process graph data:", error);
            showError(`Failed to load graph data: ${error.message}`);
            graph.clear(); // Clear graph on error
            showLoading(false);
        } finally {
            isFetchingData = false;
            console.log("fetchAndPopulateGraph finished.");
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
    function applyLayout(iterations) {
        // Check if the imported layout function exists
        if (typeof forceAtlas2Layout === 'undefined') {
             console.error("Layout library (forceAtlas2Layout) not loaded or imported correctly!");
             showError("Layout engine failed to load.");
             return;
        }
        if (!graph || !sigmaInstance || graph.order === 0) {
            console.log("Skipping layout: Graph empty or not initialized.");
            return;
        }

        const layoutIterations = iterations !== undefined ? iterations : INITIAL_LAYOUT_ITERATIONS;
        console.log(`Applying ForceAtlas2 layout (${layoutIterations} iterations)...`);
        showLoading(true); // Show loading indicator during layout

        // Use setTimeout to allow UI to update (show loading) before potentially blocking calculation
        setTimeout(() => {
            try {
                const settings = {
                    iterations: layoutIterations,
                    settings: {
                        barnesHutOptimize: true, // Crucial for performance
                        barnesHutTheta: 0.6,    // Balance speed/accuracy (0.5-1.0)
                        gravity: 1.0,           // Adjust to pull graph together or spread out
                        scalingRatio: 10.0,     // Adjust overall spread
                        strongGravityMode: false, // Usually too slow for large graphs
                        slowDown: 1 + Math.log(graph.order) / 10, // Increase slowdown for larger graphs
                        adjustSizes: false      // Prevent node sizes overly influencing layout
                    }
                };

                console.time("Layout Calculation");
                forceAtlas2Layout.assign(graph, settings); // Use the imported function
                console.log("Node positions after layout:");
                let count = 0;
                graph.forEachNode((node, attrs) => {
                    if (count < 5) { // Log first 5 nodes
                        console.log(`  Node ${node}: x=${attrs.x?.toFixed(2)}, y=${attrs.y?.toFixed(2)}`);
                    }
                    count++;
                });
                console.timeEnd("Layout Calculation");
                console.log("ForceAtlas2 layout applied.");

                 // Apply initial camera centering/zoom only after the *first* main layout run
                 if (!initialZoomApplied && graph.order > 0 && iterations >= INITIAL_LAYOUT_ITERATIONS) {
                    console.log("Applying initial camera centering and zoom out...");
                     let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                     graph.forEachNode((node, attributes) => {
                         if (attributes.x < minX) minX = attributes.x;
                         if (attributes.x > maxX) maxX = attributes.x;
                         if (attributes.y < minY) minY = attributes.y;
                         if (attributes.y > maxY) maxY = attributes.y;
                     });
                     let centerX = 0, centerY = 0;
                     if (minX !== Infinity) { // Check if nodes exist and have positions
                         centerX = (minX + maxX) / 2;
                         centerY = (minY + maxY) / 2;
                     }
                     // Start more zoomed out for large graphs
                     const targetRatio = Math.min(0.8, 20 / Math.sqrt(graph.order)); // Heuristic zoom level
                     console.log(`Centering camera on [${centerX.toFixed(2)}, ${centerY.toFixed(2)}] with ratio ${targetRatio.toFixed(3)}`);

                     sigmaInstance.getCamera().setState({ x: centerX, y: centerY, ratio: targetRatio, angle: 0 });
                     console.log("Camera state after centering:", sigmaInstance.getCamera().getState());
                     initialZoomApplied = true;
                }

            } catch (e) {
                console.error("Error applying ForceAtlas2 layout:", e);
                showError("Error occurred during graph layout.");
            } finally {
                 showLoading(false); // Hide loading indicator
                 console.log("applyLayout finished.");
            }
        }, 50); // Increased delay (50ms) to ensure loading indicator renders reliably
    }

    // --- Debounce Function ---
    function debounce(func, delay) {
        let timeoutId;
        return function(...args) {
            const context = this;
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                // No need to check isFetchingData here, fetch function handles it
                func.apply(context, args);
            }, delay);
        };
    }

    // --- Handle Slider Events ---
    function handleTimeChange() {
        let startTimeMs = parseInt(startTimeSlider.value, 10);
        let endTimeMs = parseInt(endTimeSlider.value, 10);
        startTimeMs = isNaN(startTimeMs) ? overallMinTimestamp : startTimeMs;
        endTimeMs = isNaN(endTimeMs) ? overallMaxTimestamp : endTimeMs;

        // Prevent sliders from crossing
        if (this === startTimeSlider && startTimeMs > endTimeMs) {
            endTimeSlider.value = String(startTimeMs);
            endTimeMs = startTimeMs;
        } else if (this === endTimeSlider && endTimeMs < startTimeMs) {
            startTimeSlider.value = String(endTimeMs);
            startTimeMs = endTimeMs;
        }

        startTimeLabel.textContent = formatTimestampUTC(startTimeMs);
        endTimeLabel.textContent = formatTimestampUTC(endTimeMs);
    }

    // Debounced function to fetch data when sliders stop moving
    const debouncedFetchUpdate = debounce(() => {
        let currentStartTimeMs = parseInt(startTimeSlider.value, 10);
        let currentEndTimeMs = parseInt(endTimeSlider.value, 10);
        currentStartTimeMs = isNaN(currentStartTimeMs) ? overallMinTimestamp : currentStartTimeMs;
        currentEndTimeMs = isNaN(currentEndTimeMs) ? overallMaxTimestamp : currentEndTimeMs;
        if (currentStartTimeMs > currentEndTimeMs) { // Ensure start <= end
            currentStartTimeMs = currentEndTimeMs;
        }
        fetchAndPopulateGraph(currentStartTimeMs, currentEndTimeMs);
    }, DEBOUNCE_DELAY);

    // Update labels immediately on input
    startTimeSlider.addEventListener('input', handleTimeChange);
    endTimeSlider.addEventListener('input', handleTimeChange);
    // Fetch data only when the user releases the slider (change event)
    startTimeSlider.addEventListener('change', debouncedFetchUpdate);
    endTimeSlider.addEventListener('change', debouncedFetchUpdate);

    // --- Main Execution ---
    initializeSigma();
    if (sigmaInstance && graph) {
        fetchAndPopulateGraph(); // Initial load (fetches full range by default)
    } else {
         console.error("Skipping initial data fetch: Sigma/Graphology failed initialization.");
         showError("Graph visualization failed to initialize.");
         startTimeSlider.disabled = true;
         endTimeSlider.disabled = true;
    }

}); // End of DOMContentLoaded listener