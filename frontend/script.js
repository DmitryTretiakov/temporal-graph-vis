// FILE: frontend/script.js
// frontend/script.js (Bundled Version - Phase 7 - Disappearing Fix Attempt)

// --- ES Module Imports ---
import Graph from 'graphology';
import Sigma from 'sigma';
import forceAtlas2Layout from 'graphology-layout-forceatlas2'; // Reverted to default import
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

// --- Initialize Plugins ---
dayjs.extend(utc);

// --- Wait for the DOM to be fully loaded ---
document.addEventListener("DOMContentLoaded", () => {
    console.log("DOM fully loaded and parsed (Phase 7 Version - Disappearing Fix)");

    // --- DOM Element References ---
    const graphContainer = document.getElementById('graph-container');
    const loadingIndicator = document.getElementById('loading-indicator');
    const errorDisplay = document.getElementById('error-display');
    const startTimeSlider = document.getElementById('start-time-slider');
    const endTimeSlider = document.getElementById('end-time-slider');
    const startTimeLabel = document.getElementById('start-time-label');
    const endTimeLabel = document.getElementById('end-time-label');
    const layoutButton = document.getElementById('layout-button');
    const tooltipElement = document.createElement("div");
    tooltipElement.className = "sigma-tooltip";
    document.body.appendChild(tooltipElement);

    // --- Global State ---
    let sigmaInstance = null;
    let graph = null;
    let overallMinTimestamp = 0;
    let overallMaxTimestamp = 0;
    let currentStartTimeMs = 0;
    let currentEndTimeMs = 0;
    let isFetchingData = false;
    let isDragging = false;
    let draggedNode = null;
    let dragStartX = 0;
    let dragStartY = 0;
    let initialZoomApplied = false;
    // let currentLayoutProcess = null; // Removed - not needed for sync layout

    // --- Interaction State ---
    let hoveredNode = null;
    let hoveredEdge = null;
    let selectedNode = null;
    let highlightedNodes = new Set();

    // --- Configuration ---
    const API_ENDPOINT = '/graph-data';
    const DEBOUNCE_DELAY = 400;
    const INITIAL_LAYOUT_ITERATIONS = 100;
    const MANUAL_LAYOUT_ITERATIONS = 50;
    const NODE_MIN_SIZE = 2;
    const NODE_MAX_SIZE = 15;
    const NODE_BASE_SIZE_FACTOR = 0.8;

    // --- Styling Constants ---
    const HOVER_NODE_COLOR = "#f00";
    const SELECTED_NODE_COLOR = "#00f";
    const NEIGHBOR_NODE_COLOR = "#fcba03";
    const DIMMED_NODE_COLOR = "#f0f0f0";
    const DIMMED_EDGE_COLOR = "#fafafa";
    const EDGE_COLOR_START = { r: 200, g: 200, b: 200 };
    const EDGE_COLOR_END = { r: 0, g: 100, b: 255 };
    const DEFAULT_EDGE_COLOR = '#ccc';


    console.log("Day.js initialized with UTC plugin.");

    // --- UI Helper Functions ---
    function showLoading(isLoading, message = "Loading / Calculating Layout...") {
        loadingIndicator.textContent = message;
        loadingIndicator.classList.toggle('hidden', !isLoading);
        if (isLoading) errorDisplay.classList.add('hidden');
    }

    function showError(message) {
        errorDisplay.textContent = message || "An error occurred.";
        errorDisplay.classList.remove('hidden');
        showLoading(false);
    }

    function hideError() {
         errorDisplay.classList.add('hidden');
    }

    // --- Date Formatting Helper ---
     function formatTimestampUTC(timestampMs) {
        if (timestampMs === null || timestampMs === undefined || isNaN(timestampMs)) return '-';
        if (typeof dayjs !== 'function') {
             console.warn("Day.js not available for formatting.");
             const numericTimestamp = Number(timestampMs);
             if (isNaN(numericTimestamp)) return '-';
             try { return new Date(numericTimestamp).toISOString(); } catch (e) { return '-'; }
        }
        const numericTimestamp = Number(timestampMs);
        if (isNaN(numericTimestamp)) return '-';
        return dayjs.utc(numericTimestamp).format('YYYY-MM-DD HH:mm [UTC]');
    }

     // --- Tooltip Functions ---
    function showTooltip(content, x, y) {
        tooltipElement.innerHTML = content;
        tooltipElement.style.display = "block";
        const tooltipRect = tooltipElement.getBoundingClientRect();
        const bodyRect = document.body.getBoundingClientRect();
        let left = x + 15;
        let top = y + 15;
        if (left + tooltipRect.width > bodyRect.width) { left = x - 15 - tooltipRect.width; }
        if (top + tooltipRect.height > bodyRect.height) { top = y - 15 - tooltipRect.height; }
        tooltipElement.style.left = `${left}px`;
        tooltipElement.style.top = `${top}px`;
    }

    function hideTooltip() {
        tooltipElement.style.display = "none";
    }


    // --- Color Helper ---
     function interpolateColor(startColor, endColor, factor) {
        factor = Math.max(0, Math.min(1, factor));
        const r = Math.round(startColor.r + (endColor.r - startColor.r) * factor);
        const g = Math.round(startColor.g + (endColor.g - startColor.g) * factor);
        const b = Math.round(startColor.b + (endColor.b - startColor.b) * factor);
        return `rgb(${r},${g},${b})`;
    }

    // --- Helper to get random color (Placeholder) ---
     function getRandomColor() {
        const letters = '0123456789ABCDEF';
        let color = '#';
        for (let i = 0; i < 6; i++) {
            color += letters[Math.floor(Math.random() * 16)];
        }
        return color;
    }

    // --- Sigma Reducers (for dynamic styling) ---
    const nodeReducer = (node, data) => {
        const newData = { ...data };
        if (selectedNode === node) { newData.color = SELECTED_NODE_COLOR; newData.highlighted = false; newData.zIndex = 3; }
        else if (hoveredNode === node) { newData.color = HOVER_NODE_COLOR; newData.highlighted = false; newData.zIndex = 2; }
        else if (highlightedNodes.size > 0 && !highlightedNodes.has(node)) { newData.color = DIMMED_NODE_COLOR; newData.label = null; newData.highlighted = false; newData.zIndex = 0; }
        else if (highlightedNodes.has(node)) { newData.color = NEIGHBOR_NODE_COLOR; newData.highlighted = true; newData.zIndex = 1; }
        else { newData.color = data.originalColor || getRandomColor(); newData.highlighted = false; newData.zIndex = 1; }
        return newData;
    };

    const edgeReducer = (edge, data) => {
        const newData = { ...data };
        const source = graph.source(edge);
        const target = graph.target(edge);
        const isSelectedSource = source === selectedNode;
        const isSelectedTarget = target === selectedNode;
        const isHoveredSource = source === hoveredNode;
        const isHoveredTarget = target === hoveredNode;
        const highlightEdge = highlightedNodes.has(source) && highlightedNodes.has(target);

        if (highlightedNodes.size > 0 && !highlightEdge) { newData.color = DIMMED_EDGE_COLOR; newData.hidden = true; newData.zIndex = 0; }
        else {
             const timestamp = data.timestamp;
             const range = currentEndTimeMs - currentStartTimeMs;
             let colorFactor = 0.5;
             if (range > 0 && timestamp >= currentStartTimeMs && timestamp <= currentEndTimeMs) { colorFactor = (timestamp - currentStartTimeMs) / range; }
             else if (timestamp < currentStartTimeMs) { colorFactor = 0; }
             else if (timestamp > currentEndTimeMs) { colorFactor = 1; }
             newData.color = interpolateColor(EDGE_COLOR_START, EDGE_COLOR_END, colorFactor);
             newData.hidden = false;
             newData.zIndex = 0;
        }
        if (isSelectedSource || isSelectedTarget) { newData.color = SELECTED_NODE_COLOR; newData.hidden = false; newData.zIndex = 2; }
        else if (isHoveredSource || isHoveredTarget) { newData.color = HOVER_NODE_COLOR; newData.hidden = false; newData.zIndex = 1; }
        return newData;
    };


    // --- Sigma.js Initialization ---
    function initializeSigma() {
        console.log("Initializing Sigma.js (Phase 7 - Sync Layout)...");
        if (!graphContainer) {
            console.error("Graph container #graph-container not found!");
            showError("Graph container element is missing.");
            return;
        }
        try {
            graph = new Graph({ multi: true, type: 'directed' });

            sigmaInstance = new Sigma(graph, graphContainer, {
                allowInvalidContainer: true,
                defaultNodeType: "circle",
                defaultEdgeType: "arrow",
                nodeReducer: nodeReducer,
                edgeReducer: edgeReducer,
                labelDensity: 0.1,
                labelGridCellSize: 150,
                labelRenderedSizeThreshold: 8,
                labelFont: "Lato, sans-serif",
                zIndex: true,
                hideEdgesOnMove: true,
                hideLabelsOnMove: true,
                enableCameraInteraction: true,
            });
            console.log("Sigma.js instance created.");
            setupSigmaEventHandlers();
            console.log("Sigma.js initialized successfully.");
        } catch (e) {
            console.error("Error initializing Sigma:", e);
            showError(`Failed to initialize graph visualization: ${e.message}. Check browser console.`);
            sigmaInstance = null;
            graph = null;
        }
    }

    // --- Sigma Event Handlers ---
    function setupSigmaEventHandlers() {
        if (!sigmaInstance) return;
        console.log("Setting up Sigma event handlers (Phase 7)...");
        sigmaInstance.on("downNode", (e) => { if (!e.event.original.ctrlKey) { isDragging = true; draggedNode = e.node; const initialGraphPos = graph.getNodeAttributes(draggedNode); const nodePosition = sigmaInstance.graphToViewport(initialGraphPos); const mousePosition = { x: e.event.x, y: e.event.y }; dragStartX = mousePosition.x - nodePosition.x; dragStartY = mousePosition.y - nodePosition.y; sigmaInstance.getCamera().disable(); }});
        sigmaInstance.getMouseCaptor().on("mousemove", (e) => { if (!isDragging || !draggedNode) return; const mousePosition = { x: e.x, y: e.y }; const newViewportPos = { x: mousePosition.x - dragStartX, y: mousePosition.y - dragStartY }; const newGraphPos = sigmaInstance.viewportToGraph(newViewportPos); graph.setNodeAttribute(draggedNode, "x", newGraphPos.x); graph.setNodeAttribute(draggedNode, "y", newGraphPos.y); });
        const stopDragging = () => { if (isDragging && draggedNode) {} isDragging = false; draggedNode = null; if (sigmaInstance) sigmaInstance.getCamera().enable(); };
        sigmaInstance.getMouseCaptor().on("mouseup", stopDragging);
        sigmaInstance.getMouseCaptor().on("mouseleave", stopDragging);
        sigmaInstance.on("enterNode", (e) => { if (!isDragging) { hoveredNode = e.node; highlightedNodes.clear(); highlightedNodes.add(hoveredNode); if(selectedNode !== hoveredNode) { graph.neighbors(hoveredNode).forEach(neighbor => highlightedNodes.add(neighbor)); } if (selectedNode && selectedNode !== hoveredNode) { highlightedNodes.add(selectedNode); graph.neighbors(selectedNode).forEach(neighbor => highlightedNodes.add(neighbor)); } const nodeData = graph.getNodeAttributes(hoveredNode); const tooltipContent = `ID: ${nodeData.label}<br>Degree (window): ${nodeData.degree}`; showTooltip(tooltipContent, e.event.x, e.event.y); sigmaInstance.refresh(); } });
        sigmaInstance.on("leaveNode", (e) => { if (!isDragging) { hoveredNode = null; hideTooltip(); if (!selectedNode) { highlightedNodes.clear(); } else { highlightedNodes.clear(); highlightedNodes.add(selectedNode); graph.neighbors(selectedNode).forEach(neighbor => highlightedNodes.add(neighbor)); } sigmaInstance.refresh(); } });
        sigmaInstance.on("clickNode", (e) => { if (!isDragging) { const clickedNode = e.node; if (selectedNode === clickedNode) { selectedNode = null; highlightedNodes.clear(); } else { selectedNode = clickedNode; highlightedNodes.clear(); highlightedNodes.add(selectedNode); graph.neighbors(selectedNode).forEach(neighbor => highlightedNodes.add(neighbor)); } console.log(`Selected node: ${selectedNode}`); sigmaInstance.refresh(); } });
        sigmaInstance.on("clickStage", () => { if (selectedNode && !isDragging) { selectedNode = null; highlightedNodes.clear(); console.log("Selected node cleared by stage click."); sigmaInstance.refresh(); } });
    }

    // --- Data Fetching and Graph Population ---
    async function fetchAndPopulateGraph(startTime = null, endTime = null) {
        if (!graph || !sigmaInstance) { return; }
        if (isFetchingData) { return; }
        initialZoomApplied = false;
        console.log(`Fetching graph data for window: ${startTime} -> ${endTime}`);
        isFetchingData = true;
        showLoading(true);
        hideError();
        currentStartTimeMs = startTime === null ? overallMinTimestamp : Math.round(startTime);
        currentEndTimeMs = endTime === null ? overallMaxTimestamp : Math.round(endTime);
        if (currentStartTimeMs > currentEndTimeMs) { currentStartTimeMs = currentEndTimeMs; }
        const params = new URLSearchParams();
        params.append('start_time', String(currentStartTimeMs));
        params.append('end_time', String(currentEndTimeMs));
        const url = `${API_ENDPOINT}?${params.toString()}`;
        console.log(`Requesting URL: ${url}`);
        try {
            const response = await fetch(url);
            if (!response.ok) { let errorText = "An error occurred"; try { const errorData = await response.json(); errorText = errorData.error || `HTTP error ${response.status}`; } catch (e) { errorText = `HTTP error ${response.status}: ${response.statusText}`; } throw new Error(errorText); }
            const data = await response.json();
            console.log(`Data received: ${data.nodes?.length || 0} nodes, ${data.links?.length || 0} links`);
            if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.links)) { throw new Error("Invalid data structure received from backend."); }

            // No need to stop layout for sync assign

            const existingNodes = {};
            if (graph.order > 0) { graph.forEachNode((node, attrs) => { if (attrs.x !== undefined && attrs.y !== undefined) { existingNodes[node] = { x: attrs.x, y: attrs.y }; } }); }
            graph.clear();
            console.log("Populating graphology instance...");
            let nodesAdded = 0;
            data.nodes.forEach(node => { if (node.id === null || node.id === undefined) { return; } const existingPos = existingNodes[node.id]; const degree = node.degree || 0; const targetSize = NODE_MIN_SIZE + Math.sqrt(degree) * NODE_BASE_SIZE_FACTOR; const finalSize = Math.max(NODE_MIN_SIZE, Math.min(targetSize, NODE_MAX_SIZE)); const originalColor = getRandomColor(); try { graph.addNode(node.id, { label: node.label || String(node.id), x: existingPos?.x ?? Math.random() * 1000, y: existingPos?.y ?? Math.random() * 1000, size: finalSize, degree: degree, color: originalColor, originalColor: originalColor, zIndex: 1 }); nodesAdded++; } catch (nodeError) { console.error(`Error adding node ${node.id}:`, nodeError); } });
            let edgesAdded = 0;
            data.links.forEach(link => { if (!link.source || !link.target) { return; } const sourceStr = String(link.source); const targetStr = String(link.target); if (graph.hasNode(sourceStr) && graph.hasNode(targetStr)) { try { const edgeExists = !graph.multi && graph.hasEdge(sourceStr, targetStr); if (!edgeExists) { graph.addEdge(sourceStr, targetStr, { timestamp: link.timestamp, type: 'arrow', size: 0.5, zIndex: 0 }); edgesAdded++; } else if (graph.multi) { graph.addEdge(sourceStr, targetStr, { timestamp: link.timestamp, type: 'arrow', size: 0.5, zIndex: 0 }); edgesAdded++; } } catch (edgeError) { } } });
            console.log(`Graph populated: ${nodesAdded} nodes, ${edgesAdded} edges.`);
            if (graph.order === 0) { console.warn("Graph is empty after population."); }
            if (startTime === null && endTime === null) {
                console.log("Performing initial slider setup...");
                overallMinTimestamp = data.min_timestamp; overallMaxTimestamp = data.max_timestamp;
                const now = Date.now();
                if (overallMinTimestamp === null || overallMinTimestamp === undefined || isNaN(overallMinTimestamp) || overallMaxTimestamp === null || overallMaxTimestamp === undefined || isNaN(overallMaxTimestamp) || overallMinTimestamp > overallMaxTimestamp) { console.warn("Received invalid overall timestamps from backend or range is invalid. Using defaults (last 7 days)."); overallMinTimestamp = now - (7 * 24 * 60 * 60 * 1000); overallMaxTimestamp = now; }
                currentStartTimeMs = overallMinTimestamp; currentEndTimeMs = overallMaxTimestamp;
                console.log(`Overall time range: ${overallMinTimestamp} -> ${overallMaxTimestamp}`); console.log(`Formatted: ${formatTimestampUTC(overallMinTimestamp)} -> ${formatTimestampUTC(overallMaxTimestamp)}`);
                if (overallMinTimestamp <= overallMaxTimestamp) { startTimeSlider.min = String(overallMinTimestamp); startTimeSlider.max = String(overallMaxTimestamp); endTimeSlider.min = String(overallMinTimestamp); endTimeSlider.max = String(overallMaxTimestamp); startTimeSlider.value = String(overallMinTimestamp); endTimeSlider.value = String(overallMaxTimestamp); startTimeLabel.textContent = formatTimestampUTC(overallMinTimestamp); endTimeLabel.textContent = formatTimestampUTC(overallMaxTimestamp); startTimeSlider.disabled = false; endTimeSlider.disabled = false; console.log("Sliders initialized and enabled."); }
                else { console.error("Invalid overall time range after potential defaults. Cannot initialize sliders."); showError("Error: Invalid time range data from server."); startTimeSlider.disabled = true; endTimeSlider.disabled = true; }
            }
            if (graph.order > 0) { console.log("Triggering initial layout calculation..."); applyLayout(INITIAL_LAYOUT_ITERATIONS); }
            else { showLoading(false); }
            // sigmaInstance.refresh(); // Refresh is called within applyLayout's finally block now
        } catch (error) {
            console.error("Failed to fetch or process graph data:", error);
            showError(`Failed to load graph data: ${error.message}`);
            graph.clear();
            showLoading(false);
        } finally {
            isFetchingData = false;
            console.log("fetchAndPopulateGraph finished.");
        }
    }


    // --- Layout Function (Synchronous Version) ---
    function applyLayout(iterations, manualTrigger = false) {
        // Check if the imported layout object exists and is a function (assign)
        if (typeof forceAtlas2Layout !== 'function') {
             console.error("Layout library (forceAtlas2Layout assign function) not loaded or imported correctly!");
             showError("Layout engine failed to load.");
             return;
        }
        if (!graph || !sigmaInstance || graph.order === 0) {
            console.log("Skipping layout: Graph empty or not initialized.");
            return; // Don't show/hide loading if not running layout
        }

        const layoutIterations = iterations !== undefined ? iterations : INITIAL_LAYOUT_ITERATIONS;
        console.log(`Applying ForceAtlas2 layout (${layoutIterations} iterations)...`);
        showLoading(true, "Calculating Layout...");

        // Use setTimeout to allow the loading indicator to render before blocking
        setTimeout(() => {
            const settings = {
                iterations: layoutIterations,
                settings: {
                    barnesHutOptimize: graph.order > 1000,
                    barnesHutTheta: 0.6,
                    gravity: 1.0,       // Might need adjustment if nodes fly away
                    scalingRatio: 10.0, // Might need adjustment
                    strongGravityMode: false,
                    slowDown: 1 + Math.log(graph.order) / 10,
                    adjustSizes: false
                }
            };

            console.time("Layout Calculation");
            let layoutSuccess = false;
            try {
                 // Use the synchronous assign method
                 forceAtlas2Layout.assign(graph, settings);
                 console.timeEnd("Layout Calculation");
                 console.log("ForceAtlas2 layout applied.");
                 layoutSuccess = true; // Mark layout as successful

                 // *** Add Coordinate Check ***
                 let invalidCoordsFound = false;
                 graph.forEachNode((node, attrs) => {
                     if (!isFinite(attrs.x) || !isFinite(attrs.y)) {
                         console.error(`  Node ${node}: INVALID coordinates after layout! x=${attrs.x}, y=${attrs.y}`);
                         invalidCoordsFound = true;
                         // Optional: Try to reset invalid coords to prevent breaking camera
                         // graph.setNodeAttribute(node, 'x', Math.random() * 100);
                         // graph.setNodeAttribute(node, 'y', Math.random() * 100);
                     }
                 });

                 if (invalidCoordsFound) {
                      showError("Layout produced invalid coordinates! Graph might disappear or camera might fail.");
                      // Optionally skip centering if coords are bad
                      // layoutSuccess = false;
                 }


                 // Center camera immediately after synchronous layout completes (if successful)
                //  if (layoutSuccess) {
                //     if (!initialZoomApplied && graph.order > 0 && layoutIterations >= INITIAL_LAYOUT_ITERATIONS) {
                //         centerCamera();
                //         initialZoomApplied = true;
                //     } else if (manualTrigger) {
                //         centerCamera();
                //     }
                //  }


            } catch (e) {
                 console.error("Error applying ForceAtlas2 layout:", e);
                 showError("Error occurred during graph layout.");
                 console.timeEnd("Layout Calculation");
            } finally {
                 showLoading(false); // Hide loading indicator
                 console.log("applyLayout finished.");
                 // Refresh sigma instance to show new positions (even if centering failed)
                //  if (sigmaInstance) {
                //       console.log("Refreshing Sigma instance after layout attempt.");
                //       sigmaInstance.refresh();
                //  }
            }
        }, 10); // Very short delay just to allow UI update
    }

    function centerCamera() {
         if (!sigmaInstance || graph.order === 0) return;

         console.log("Applying camera centering and zoom...");
         console.log("Camera state BEFORE centering:", sigmaInstance.getCamera().getState());

         let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
         let hasFiniteCoords = false;
         graph.forEachNode((node, attributes) => {
             // *** Check coordinates are finite before using them for bounds ***
             if (isFinite(attributes.x) && isFinite(attributes.y)) {
                  if (attributes.x < minX) minX = attributes.x;
                  if (attributes.x > maxX) maxX = attributes.x;
                  if (attributes.y < minY) minY = attributes.y;
                  if (attributes.y > maxY) maxY = attributes.y;
                  hasFiniteCoords = true;
             } else {
                 console.warn(`Node ${node} has invalid coordinates (x=${attributes.x}, y=${attributes.y}) - skipping for bound calculation.`);
             }
         });

         if (!hasFiniteCoords) {
             console.warn("Cannot center camera: No nodes with finite coordinates found after layout.");
             // Reset camera to a default view if bounds are invalid
             sigmaInstance.getCamera().animate({ x: 0.5, y: 0.5, ratio: 1, angle: 0 }, { duration: 200 });
             return;
         }

         // Handle case where all valid nodes are at the same point or bounds are still invalid
         if (minX === Infinity || minY === Infinity || maxX === -Infinity || maxY === -Infinity || (minX === maxX && minY === maxY)) {
              console.warn("Cannot determine valid bounds for camera centering (single point or invalid bounds). Using default view.");
              // Use coordinates of the first valid node found, or default if none
              const firstNode = graph.findNode(n => isFinite(graph.getNodeAttribute(n, 'x')) && isFinite(graph.getNodeAttribute(n, 'y')));
              const targetX = firstNode ? graph.getNodeAttribute(firstNode, 'x') : 0.5;
              const targetY = firstNode ? graph.getNodeAttribute(firstNode, 'y') : 0.5;
              sigmaInstance.getCamera().animate({ x: targetX, y: targetY, ratio: 1, angle: 0 }, { duration: 200 });
              return;
         }

         // --- Proceed with normal centering calculation ---
         const graphWidth = maxX - minX || 1; // Avoid division by zero
         const graphHeight = maxY - minY || 1;
         const graphRatio = graphWidth / graphHeight;

         const { width: vpWidth, height: vpHeight } = sigmaInstance.getDimensions();
         const viewportRatio = vpWidth / vpHeight;

         let targetRatio;
         if (graphRatio > viewportRatio) { targetRatio = graphWidth / vpWidth; }
         else { targetRatio = graphHeight / vpHeight; }

         targetRatio *= 1.2; // Padding factor
         targetRatio = sigmaInstance.getCamera().getBoundedRatio(targetRatio); // Apply min/max zoom limits

         // Ensure targetRatio is a valid positive number
         if (!isFinite(targetRatio) || targetRatio <= 0) {
              console.warn(`Calculated invalid targetRatio (${targetRatio}). Resetting ratio to 1.`);
              targetRatio = 1;
         }

         const centerX = (minX + maxX) / 2;
         const centerY = (minY + maxY) / 2;

         console.log(`Centering camera on graph coords [${centerX.toFixed(2)}, ${centerY.toFixed(2)}] with ratio ${targetRatio.toFixed(3)}`);
         sigmaInstance.getCamera().animate(
             { x: centerX, y: centerY, ratio: targetRatio, angle: 0 },
             { duration: 300 } // Animation duration
         ).then(() => {
             console.log("Camera animation finished. Final state:", sigmaInstance.getCamera().getState());
         });
    }


    // --- Debounce Function ---
    function debounce(func, delay) {
        let timeoutId;
        return function(...args) {
            const context = this;
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                func.apply(context, args);
            }, delay);
        };
    }

    // --- Handle Slider Events ---
    function handleTimeChange() {
        let startTimeMs = parseInt(startTimeSlider.value, 10);
        let endTimeMs = parseInt(endTimeSlider.value, 10);
        const minVal = parseInt(startTimeSlider.min, 10);
        const maxVal = parseInt(endTimeSlider.max, 10);

        startTimeMs = isNaN(startTimeMs) ? (isNaN(minVal)? overallMinTimestamp : minVal) : startTimeMs;
        endTimeMs = isNaN(endTimeMs) ? (isNaN(maxVal)? overallMaxTimestamp : maxVal) : endTimeMs;

        if (this === startTimeSlider && startTimeMs > endTimeMs) { endTimeSlider.value = String(startTimeMs); endTimeMs = startTimeMs; }
        else if (this === endTimeSlider && endTimeMs < startTimeMs) { startTimeSlider.value = String(endTimeMs); startTimeMs = endTimeMs; }

        currentStartTimeMs = startTimeMs;
        currentEndTimeMs = endTimeMs;

        startTimeLabel.textContent = formatTimestampUTC(startTimeMs);
        endTimeLabel.textContent = formatTimestampUTC(endTimeMs);

        if (sigmaInstance) { sigmaInstance.refresh(); }
    }

    // Debounced function to fetch data when sliders stop moving
    const debouncedFetchUpdate = debounce(() => {
        if (startTimeSlider.disabled || endTimeSlider.disabled) return;
        let fetchStartTimeMs = parseInt(startTimeSlider.value, 10);
        let fetchEndTimeMs = parseInt(endTimeSlider.value, 10);
        fetchStartTimeMs = isNaN(fetchStartTimeMs) ? overallMinTimestamp : fetchStartTimeMs;
        fetchEndTimeMs = isNaN(fetchEndTimeMs) ? overallMaxTimestamp : fetchEndTimeMs;
        if (fetchStartTimeMs > fetchEndTimeMs) { fetchStartTimeMs = fetchEndTimeMs; }
        console.log("Debounced fetch triggered...");
        fetchAndPopulateGraph(fetchStartTimeMs, fetchEndTimeMs);
    }, DEBOUNCE_DELAY);


    // --- Event Listeners ---
    startTimeSlider.addEventListener('input', handleTimeChange);
    endTimeSlider.addEventListener('input', handleTimeChange);
    startTimeSlider.addEventListener('change', debouncedFetchUpdate);
    endTimeSlider.addEventListener('change', debouncedFetchUpdate);

    if (layoutButton) {
         layoutButton.addEventListener('click', () => {
             console.log("Manual layout trigger clicked.");
             applyLayout(MANUAL_LAYOUT_ITERATIONS, true);
         });
    }


    // --- Main Execution ---
    initializeSigma();
    if (sigmaInstance && graph) {
        fetchAndPopulateGraph();
    } else {
         console.error("Skipping initial data fetch: Sigma/Graphology failed initialization.");
         startTimeSlider.disabled = true;
         endTimeSlider.disabled = true;
         if(layoutButton) layoutButton.disabled = true;
    }

}); // End of DOMContentLoaded listener

// --- Add CSS for Tooltip ---
const style = document.createElement('style');
style.textContent = `
  .sigma-tooltip {
    position: absolute;
    display: none;
    background-color: rgba(255, 255, 255, 0.9);
    border: 1px solid #ccc;
    padding: 5px 8px;
    border-radius: 4px;
    font-family: sans-serif;
    font-size: 12px;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
    pointer-events: none;
    z-index: 1000;
    max-width: 250px;
    word-wrap: break-word;
    white-space: pre-wrap;
  }
`;
document.head.appendChild(style);