// Wait for the DOM to be fully loaded before running scripts
document.addEventListener("DOMContentLoaded", () => {
    console.log("DOM fully loaded and parsed");

    // --- DOM Element References (Keep as before) ---
    const graphContainer = document.getElementById('graph-container');
    const loadingIndicator = document.getElementById('loading-indicator');
    const errorDisplay = document.getElementById('error-display');
    const startTimeLabel = document.getElementById('start-time-label');
    const endTimeLabel = document.getElementById('end-time-label');
    // Add references for slider controls later in Phase 6

    // --- Global State (Keep as before) ---
    let sigmaInstance = null;
    let graph = null; // Graphology instance
    let overallMinTimestamp = 0;
    let overallMaxTimestamp = 0;

    // --- Configuration ---
    // Define backend API endpoint URL
    // Assumes backend runs on the same host/port for development simplicity
    // If backend is elsewhere, use full URL like 'http://<backend_ip>:<backend_port>/graph-data'
    const API_ENDPOINT = '/graph-data'; // Relative path works if frontend served by Flask or same origin

    // --- UI Helper Functions (Keep as before) ---
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

    // --- Sigma.js Initialization (Keep as before) ---
    function initializeSigma() {
        console.log("Initializing Sigma.js...");
        console.log("Graph container element:", graphContainer); 
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
            setupSigmaEventHandlers();

        } catch (e) {
            console.error("Error initializing Sigma:", e);
            showError("Failed to initialize graph visualization.");
        }
    }

    // --- Sigma Event Handlers (Keep as before - Placeholders) ---
    function setupSigmaEventHandlers() {
         if (!sigmaInstance) return;
         console.log("Setting up Sigma event handlers...");
        // Will be filled in Phase 7
    }

    // --- Data Fetching and Graph Population (NEW) ---
    async function fetchAndPopulateGraph(startTime = null, endTime = null) {
        if (!graph || !sigmaInstance) {
            console.error("Graph or Sigma instance not initialized.");
            showError("Initialization failed. Cannot load data.");
            return;
        }

        console.log(`Fetching graph data for window: ${startTime} -> ${endTime}`);
        showLoading(true);
        hideError(); // Hide previous errors

        // Construct query parameters if provided
        const params = new URLSearchParams();
        if (startTime !== null) params.append('start_time', startTime);
        if (endTime !== null) params.append('end_time', endTime);
        const url = `${API_ENDPOINT}?${params.toString()}`;

        try {
            const response = await fetch(url);

            if (!response.ok) {
                // Handle HTTP errors (like 4xx, 5xx)
                const errorData = await response.json().catch(() => ({ error: 'Unknown server error' })); // Try to parse error JSON
                throw new Error(`HTTP error ${response.status}: ${errorData.error || response.statusText}`);
            }

            const data = await response.json();
            console.log("Data received from backend:", data);

            // --- Populate Graphology ---
            graph.clear(); // Clear previous data

            // Add nodes
            data.nodes.forEach(node => {
                // Add node if it doesn't exist (Graphology handles duplicates)
                if (!graph.hasNode(node.id)) {
                     graph.addNode(node.id, {
                        label: node.label, // Use label from data
                        // Initial random position - layout algorithm will fix this later
                        x: Math.random() * 100,
                        y: Math.random() * 100,
                        // Size based on degree (adjust scaling factor as needed)
                        size: Math.max(3, Math.sqrt(node.degree || 1) * 2), // Min size 3, scale by sqrt(degree)
                        degree: node.degree || 0, // Store degree for potential use (tooltips)
                        color: getRandomColor() // Assign a random color for now
                    });
                } else {
                    // If node exists, update its attributes (like degree and size)
                    graph.setNodeAttribute(node.id, 'degree', node.degree || 0);
                    graph.setNodeAttribute(node.id, 'size', Math.max(3, Math.sqrt(node.degree || 1) * 2));
                    // Optionally update other attributes if they can change
                }
            });

            // Add edges
            let edgeCount = 0;
            data.links.forEach(link => {
                try {
                    // Check if source and target nodes actually exist in the graph before adding edge
                    if (graph.hasNode(link.source) && graph.hasNode(link.target)) {
                         // Use a unique edge key if multiple edges can exist (Graphology handles this if multi: true)
                         // graph.addEdgeWithKey(unique_edge_id, link.source, link.target, { ... });
                         // Or just addEdge if duplicates aren't expected per exact timestamp (less likely)
                         graph.addEdge(link.source, link.target, {
                            timestamp: link.timestamp,
                            type: 'arrow', // Ensure it's an arrow
                            size: 1, // Default edge size (can be styled later)
                            color: '#ccc' // Default edge color
                        });
                        edgeCount++;
                    } else {
                        console.warn(`Skipping edge: Node missing for link ${link.source} -> ${link.target}`);
                    }
                } catch (e) {
                    // Catch errors during edge addition (e.g., if source/target nodes don't exist)
                    console.error(`Error adding edge ${link.source} -> ${link.target}:`, e);
                }
            });

            console.log(`Graph populated: ${graph.order} nodes, ${edgeCount} edges added.`);

            // Store overall timestamps (only needed on initial load really)
            if (startTime === null && endTime === null) {
                overallMinTimestamp = data.min_timestamp;
                overallMaxTimestamp = data.max_timestamp;
                console.log(`Overall time range set: ${overallMinTimestamp} -> ${overallMaxTimestamp}`);
                // We'll initialize the slider here in Phase 6
            }

            // Apply layout (placeholder for now - Phase 7)
            // applyLayout();

            // Refresh Sigma instance (important after graph changes)
            // No explicit refresh needed in Sigma v2 usually, it reacts to Graphology changes.

        } catch (error) {
            console.error("Failed to fetch or process graph data:", error);
            showError(`Failed to load graph data: ${error.message}`);
            graph.clear(); // Clear graph on error to avoid showing stale data
        } finally {
            showLoading(false); // Hide loading indicator regardless of success/failure
        }
    }

    // --- Helper for random colors (temporary) ---
    function getRandomColor() {
        const letters = '0123456789ABCDEF';
        let color = '#';
        for (let i = 0; i < 6; i++) {
            color += letters[Math.floor(Math.random() * 16)];
        }
        return color;
    }

    // --- Layout Function (Placeholder) ---
    function applyLayout() {
        if (!graph || !sigmaInstance) return;
        console.log("Applying layout (placeholder)...");
        // Layout logic using ForceAtlas2 will go here in Phase 7
        // For now, Sigma's default auto-adjustment might do something minimal
    }


    // --- Main Execution ---
    initializeSigma();
    // Fetch initial data for the full time range on page load
    fetchAndPopulateGraph(); // Call without parameters for initial load

}); // End of DOMContentLoaded listener