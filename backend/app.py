import os
from flask import Flask, jsonify, request, g, send_from_directory # Added send_from_directory
from neo4j import GraphDatabase
from dotenv import load_dotenv
import sys
import time # Import time for default timestamp calculation if needed
import traceback # Import traceback for better error logging

# --- Configuration Loading ---
dotenv_path = os.path.join(os.path.dirname(__file__), '..', '.env')
load_dotenv(dotenv_path=dotenv_path)

# --- Determine Frontend Directory Path ---
# Assumes the 'frontend' directory is at the same level as the 'backend' directory
# i.e., project_root/frontend and project_root/backend
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# frontend_folder = os.path.join(project_root, 'frontend') # OLD

# --- Flask App Initialization (UPDATED) ---
# Configure the static folder to point to our 'frontend' directory
app = Flask(__name__, static_folder=project_root, static_url_path='')

# --- Neo4j Driver Setup (Keep as before) ---
NEO4J_URI = os.getenv("NEO4J_URI")
NEO4J_USER = os.getenv("NEO4J_USER")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD")
driver = None
try:
    driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
    driver.verify_connectivity()
    print("Successfully connected to Neo4j.")
except Exception as e:
    print(f"ERROR: Failed to create Neo4j driver or connect: {e}", file=sys.stderr)
    driver = None

# --- Neo4j Session Management (Keep as before) ---
def get_db():
    if not hasattr(g, 'neo4j_db'):
        if driver is None:
            print("ERROR: Neo4j driver not available.", file=sys.stderr)
            g.neo4j_db = None
        else:
            try:
                # Ensure driver is still valid before creating session
                driver.verify_connectivity()
                g.neo4j_db = driver.session()
            except Exception as e:
                 print(f"ERROR: Failed to create Neo4j session: {e}", file=sys.stderr)
                 g.neo4j_db = None # Set session to None if connection fails here too
    return g.neo4j_db

@app.teardown_appcontext
def close_db(exception):
    if hasattr(g, 'neo4j_db') and g.neo4j_db is not None:
        g.neo4j_db.close()

# --- Transaction Functions (UPDATED) ---

def _get_overall_time_range_tx(tx):
    """Gets the absolute minimum and maximum timestamp from all REPOSTED relationships."""
    query = """
    MATCH ()-[r:REPOSTED]->()
    WHERE r.timestamp IS NOT NULL
    RETURN min(r.timestamp) as min_ts, max(r.timestamp) as max_ts
    """
    result = tx.run(query).single()
    if result and result["min_ts"] is not None and result["max_ts"] is not None:
        return result["min_ts"], result["max_ts"]
    else:
        # Return defaults if no timestamps found (e.g., empty DB or no timestamps set)
        print("WARNING: Could not determine overall time range from database.")
        return 0, int(time.time() * 1000) # Default to epoch start and current time

def _get_filtered_graph_data_tx(tx, start_time_ms, end_time_ms):
    """
    Fetches nodes and links within the specified time window and calculates
    node degrees based *only* on connections within that window.
    """
    # This query uses the provided time range to filter relationships ($startTime, $endTime).
    # It then finds all nodes connected by these filtered relationships.
    # Finally, it calculates the degree for each of these nodes based *only*
    # on the relationships that fall within the time window.
    query = """
    // Match relationships within the time window
    MATCH (source:Channel)-[r:REPOSTED]->(target:Channel)
    WHERE r.timestamp >= $startTime AND r.timestamp <= $endTime

    // Collect the distinct nodes involved in these relationships
    WITH collect(DISTINCT source) + collect(DISTINCT target) AS nodes_in_window,
         // Collect the filtered relationships for the links output
         collect({source: source.channel_id, target: target.channel_id, timestamp: r.timestamp}) AS links_in_window

    // Unwind the distinct nodes to process them individually
    UNWIND nodes_in_window AS n

    // Calculate the degree for each node 'n' considering ONLY relationships within the time window
    // We need to re-match relationships connected to 'n' within the window to count degree correctly
    WITH n, links_in_window, count {
        MATCH (n)-[r_deg:REPOSTED]-(neighbor) // Match incoming or outgoing
        WHERE r_deg.timestamp >= $startTime AND r_deg.timestamp <= $endTime
    } AS degree_in_window

    // Collect the final node data (ensure distinct nodes)
    WITH links_in_window, collect(DISTINCT {id: n.channel_id, label: n.channel_id, degree: degree_in_window}) AS nodes_data

    RETURN nodes_data, links_in_window
    """
    result = tx.run(query, startTime=start_time_ms, endTime=end_time_ms).single()

    if result:
        return result["nodes_data"], result["links_in_window"]
    else:
        # Return empty lists if no data found in the window
        return [], []


# --- API Routes ---
@app.route('/')
def serve_index():
     # Serve index.html specifically from the frontend subfolder
     try:
         # Use os.path.join for cross-platform compatibility
         return send_from_directory(os.path.join(app.static_folder, 'frontend'), 'index.html')
     except FileNotFoundError:
          print(f"ERROR: index.html not found in {os.path.join(app.static_folder, 'frontend')}", file=sys.stderr)
          return "Error: index.html not found.", 404

@app.route('/graph-data')
def get_graph_data():
    """
    API endpoint to fetch graph data, filtered by time window.
    Accepts optional 'start_time' and 'end_time' query parameters (Unix ms).
    Defaults to the full time range in the database if parameters are missing.
    """
    db = get_db()
    if db is None:
        return jsonify({"error": "Database connection not available"}), 503

    try:
        # 1. Determine overall time range for sliders/defaults
        min_ts_overall, max_ts_overall = db.read_transaction(_get_overall_time_range_tx)

        # 2. Parse and validate query parameters
        start_time_ms = None
        end_time_ms = None
        try:
            start_time_str = request.args.get('start_time')
            if start_time_str:
                start_time_ms = int(start_time_str)

            end_time_str = request.args.get('end_time')
            if end_time_str:
                end_time_ms = int(end_time_str)

        except (ValueError, TypeError):
            print(f"WARNING: Invalid timestamp format received. start='{start_time_str}', end='{end_time_str}'")
            return jsonify({"error": "Invalid timestamp format for start_time/end_time. Expecting integer milliseconds."}), 400

        # 3. Set defaults if parameters are missing
        if start_time_ms is None:
            start_time_ms = min_ts_overall
        if end_time_ms is None:
            end_time_ms = max_ts_overall

        # Ensure start <= end, swap if necessary or handle as error (optional)
        if start_time_ms > end_time_ms:
             print(f"WARNING: start_time ({start_time_ms}) is after end_time ({end_time_ms}). Swapping.")
             start_time_ms, end_time_ms = end_time_ms, start_time_ms # Simple swap

        print(f"Querying graph data for window: {start_time_ms} -> {end_time_ms}") # Debug print

        # 4. Fetch filtered graph data using the determined time window
        nodes_data, links_data = db.read_transaction(_get_filtered_graph_data_tx, start_time_ms, end_time_ms)

        # 5. Construct JSON response
        response_data = {
            "nodes": nodes_data,
            "links": links_data,
            "min_timestamp": min_ts_overall, # Always return overall range for slider
            "max_timestamp": max_ts_overall  # Always return overall range for slider
        }
        return jsonify(response_data)

    except Exception as e:
        # Log the detailed error to the console/log file
        print(f"ERROR: Failed processing /graph-data request: {e}", file=sys.stderr)
        # Optionally log the stack trace
        import traceback
        traceback.print_exc()
        # Return a generic error to the client
        return jsonify({"error": "An internal server error occurred while retrieving graph data"}), 500


# --- Main Execution (Keep as before, add one print statement) ---
if __name__ == '__main__':
    host = os.getenv('FLASK_HOST', '127.0.0.1')
    port = int(os.getenv('FLASK_PORT', 5000))
    debug_mode = os.getenv('FLASK_DEBUG', 'False').lower() in ('true', '1', 't')

    # ADD THIS LINE for confirmation:
    print(f"Serving static files from project root: {project_root}")
    # Print the host, port, and debug mode for clarity
    print(f"Starting Flask server on {host}:{port} with debug={debug_mode}")
    app.run(host=host, port=port, debug=debug_mode)