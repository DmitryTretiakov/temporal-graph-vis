import os
from flask import Flask, jsonify, request, g
from neo4j import GraphDatabase, basic_auth
from dotenv import load_dotenv

# --- Configuration Loading ---
# Load environment variables from .env file located in the parent directory
dotenv_path = os.path.join(os.path.dirname(__file__), '..', '.env')
load_dotenv(dotenv_path=dotenv_path)

# --- Flask App Initialization ---
app = Flask(__name__)

# --- Neo4j Driver Setup ---
NEO4J_URI = os.getenv("NEO4J_URI")
NEO4J_USER = os.getenv("NEO4J_USER")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD")

# Global driver variable
driver = None

try:
    # Create the Neo4j driver instance
    # Use basic_auth for clarity if needed, or direct tuple
    driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
    # Verify connection is possible
    driver.verify_connectivity()
    print("Successfully connected to Neo4j.")
except Exception as e:
    print(f"ERROR: Failed to create Neo4j driver or connect: {e}")
    # Keep driver as None if connection failed
    driver = None

# --- Neo4j Session Management ---
def get_db():
    """
    Opens a new Neo4j session if there is none for the current context.
    Uses Flask's application context 'g' to store the session per request.
    """
    if not hasattr(g, 'neo4j_db'):
        if driver is None:
            # If driver initialization failed at startup, raise error or handle
            print("ERROR: Neo4j driver not available.")
            # Option 1: Raise an exception
            # raise ConnectionError("Neo4j driver not available.")
            # Option 2: Return None, let route handle it
            g.neo4j_db = None
        else:
            # Store the session in the application context
            g.neo4j_db = driver.session()
    return g.neo4j_db

@app.teardown_appcontext
def close_db(exception):
    """Closes the Neo4j session on exiting the context."""
    if hasattr(g, 'neo4j_db') and g.neo4j_db is not None:
        # print("Closing Neo4j session.") # Uncomment for debugging
        g.neo4j_db.close()

# --- Transaction Functions (Read-Only Example) ---
# These functions execute Cypher queries within a transaction context.
# We'll make these more complex in Phase 3.

def _get_nodes_tx(tx):
    # Basic query to get a few nodes - REPLACE WITH REAL QUERY LATER
    query = (
        "MATCH (n:Channel) "
        "RETURN n.channel_id as id, n.channel_id as label "
        "LIMIT 5" # Limit results for initial testing
    )
    result = tx.run(query)
    return [record.data() for record in result]

def _get_links_tx(tx):
    # Basic query to get a few relationships - REPLACE WITH REAL QUERY LATER
    query = (
        "MATCH (s:Channel)-[r:REPOSTED]->(t:Channel) "
        "RETURN s.channel_id as source, t.channel_id as target, r.timestamp as timestamp "
        "LIMIT 5" # Limit results for initial testing
    )
    result = tx.run(query)
    return [record.data() for record in result]

def _get_timestamps_tx(tx):
    # Basic query to get min/max timestamps - REPLACE WITH REAL QUERY LATER
    query = (
        "MATCH ()-[r:REPOSTED]->() "
        "WHERE r.timestamp IS NOT NULL "
        "RETURN min(r.timestamp) as min_ts, max(r.timestamp) as max_ts"
    )
    result = tx.run(query).single() # Expecting only one result row
    if result and result["min_ts"] is not None and result["max_ts"] is not None:
        return result.data()
    else:
        # Return defaults if no timestamps found (e.g., empty DB)
        return {"min_ts": 0, "max_ts": 0}

# --- API Routes ---
@app.route('/')
def index():
    """Basic route to check if the backend is running."""
    return "Backend is running!"

@app.route('/graph-data')
def get_graph_data():
    """
    API endpoint to fetch graph data.
    Currently fetches limited sample data.
    Will be enhanced with time filtering in Phase 3.
    """
    start_time_str = request.args.get('start_time')
    end_time_str = request.args.get('end_time')

    print(f"Received request for /graph-data. start_time={start_time_str}, end_time={end_time_str}") # Debug print

    db = get_db()
    if db is None:
        # Handle case where DB connection failed at startup
        return jsonify({"error": "Database connection not available"}), 503

    try:
        # Execute queries using read transactions
        nodes = db.read_transaction(_get_nodes_tx)
        links = db.read_transaction(_get_links_tx)
        timestamps = db.read_transaction(_get_timestamps_tx)

        # Placeholder for degree calculation (will be added in Phase 3)
        for node in nodes:
            node['degree'] = 0 # Assign default degree for now

        response_data = {
            "nodes": nodes,
            "links": links,
            "min_timestamp": timestamps.get("min_ts", 0),
            "max_timestamp": timestamps.get("max_ts", 0)
        }
        return jsonify(response_data)

    except Exception as e:
        print(f"ERROR: Failed to query Neo4j: {e}")
        # Consider more specific error handling later
        return jsonify({"error": "Failed to retrieve graph data from database"}), 500

# --- Main Execution ---
if __name__ == '__main__':
    # Get host and port from environment variables
    host = os.getenv('FLASK_HOST', '127.0.0.1') # Default to localhost if not set
    port = int(os.getenv('FLASK_PORT', 5000)) # Default to 5000 if not set

    # Check if running with Flask's built-in server (for development)
    # DO NOT use debug=True in a production environment or with production WSGI servers
    # For development: set FLASK_DEBUG=1 in .env or use `flask run --debug`
    debug_mode = os.getenv('FLASK_DEBUG', 'False').lower() in ('true', '1', 't')

    print(f"Starting Flask server on {host}:{port} with debug={debug_mode}")
    app.run(host=host, port=port, debug=debug_mode)