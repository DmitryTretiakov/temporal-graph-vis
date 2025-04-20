// Wait for the DOM to be fully loaded before running scripts
document.addEventListener("DOMContentLoaded", () => {
    console.log("DOM fully loaded and parsed");

    // --- DOM Element References ---
    const graphContainer = document.getElementById('graph-container');
    const loadingIndicator = document.getElementById('loading-indicator');
    const errorDisplay = document.getElementById('error-display');
    const startTimeLabel = document.getElementById('start-time-label');
    const endTimeLabel = document.getElementById('end-time-label');
    // Add references for slider controls later in Phase 6

    // --- Global State (optional but helpful) ---
    let sigmaInstance = null;
    let graph = null; // Graphology instance
    let overallMinTimestamp = 0;
    let overallMaxTimestamp = 0;

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
        errorDisplay.textContent = message || "An error occurred."; // Default message
        errorDisplay.classList.remove('hidden');
        showLoading(false); // Hide loading indicator if error occurs
    }

    function hideError() {
         errorDisplay.classList.add('hidden');
    }

    // --- Sigma.js Initialization ---
    function initializeSigma() {
        console.log("Initializing Sigma.js...");
        try {
            // Create a new Graphology instance
            graph = new graphology.Graph({ multi: true, type: 'directed' }); // Allow parallel edges, directed graph

            // Instantiate Sigma.js
            sigmaInstance = new Sigma(graph, graphContainer, {
                // Basic Sigma settings (can be customized later)
                allowInvalidContainer: true, // Useful if container size changes
                defaultNodeType: "circle",
                defaultEdgeType: "arrow", // Use 'arrow' for directed edges
                labelDensity: 0.07,
                labelGridCellSize: 60,
                labelRenderedSizeThreshold: 15,
                labelFont: "Lato, sans-serif",
                zIndex: true, // Render edges behind nodes
            });

            console.log("Sigma.js initialized successfully.");

            // Add basic interaction handlers (optional for this phase, but good structure)
            setupSigmaEventHandlers();

        } catch (e) {
            console.error("Error initializing Sigma:", e);
            showError("Failed to initialize graph visualization.");
        }
    }

    // --- Sigma Event Handlers (Placeholders) ---
    function setupSigmaEventHandlers() {
         if (!sigmaInstance) return;
         console.log("Setting up Sigma event handlers...");
        // Example placeholders - will be filled in Phase 7
        sigmaInstance.on("enterNode", (event) => {
            // console.log("Enter node:", event.node);
        });
        sigmaInstance.on("leaveNode", (event) => {
            // console.log("Leave node:", event.node);
        });
         sigmaInstance.on("clickNode", (event) => {
            // console.log("Click node:", event.node);
        });
        // Add more handlers for edges, clicks, etc. later
    }

    // --- Main Execution ---
    initializeSigma();
    // We will call the data fetching function here in the next phase

}); // End of DOMContentLoaded listener