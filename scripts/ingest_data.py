import os
import sys
import pandas as pd
from neo4j import GraphDatabase, basic_auth
from dotenv import load_dotenv
import time
from datetime import timezone # Import timezone directly

# --- Configuration Loading (Keep as before) ---
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
dotenv_path = os.path.join(project_root, '.env')
load_dotenv(dotenv_path=dotenv_path)

NEO4J_URI = os.getenv("NEO4J_URI")
NEO4J_USER = os.getenv("NEO4J_USER")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD")
SOURCE_DATA_PATH_RELATIVE = os.getenv("SOURCE_DATA_PATH")
SOURCE_DATA_PATH = os.path.join(project_root, SOURCE_DATA_PATH_RELATIVE)

# --- Helper Functions (Keep as before) ---
def datetime_to_ms_epoch(dt):
    """Converts a datetime object to milliseconds epoch UTC."""
    if pd.isna(dt): # Handle potential missing datetime values
        return None
    if dt.tzinfo is None:
        # If timezone info is missing, explicitly assume UTC, matching the Neo4j storage goal
        # Alternatively, you could raise an error or log a warning
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.astimezone(tz=timezone.utc).timestamp() * 1000)

# --- Neo4j Interaction Functions (Keep as before) ---
def create_constraints_indexes(tx):
    """Creates necessary constraints and indexes if they don't exist."""
    print("Creating constraints and indexes...")
    tx.run("CREATE CONSTRAINT channel_id_unique IF NOT EXISTS FOR (c:Channel) REQUIRE c.channel_id IS UNIQUE")
    tx.run("CREATE INDEX repost_timestamp_idx IF NOT EXISTS FOR ()-[r:REPOSTED]-() ON (r.timestamp)")
    print("Constraints and indexes checked/created.")

def ingest_data_batch(tx, batch_data):
    """Ingests a batch of data using UNWIND for efficiency."""
    # Query uses UNWIND, MERGEs nodes, uses WITH to carry forward nodes and row data,
    # filters rows with missing data using WHERE, then creates the relationship.
    query = """
    UNWIND $batch as row
    MERGE (source:Channel {channel_id: row.source_id})
    MERGE (target:Channel {channel_id: row.target_id})
    // Use WITH to carry forward the matched/created nodes and the original row data
    WITH source, target, row
    // Filter rows HERE using the carried-forward 'row' data
    WHERE row.source_id IS NOT NULL
      AND row.target_id IS NOT NULL
      AND row.timestamp_ms IS NOT NULL
      AND source IS NOT NULL // Also ensure MERGE succeeded (should always if ID not null)
      AND target IS NOT NULL // Also ensure MERGE succeeded
    // Create relationship only for valid, non-null rows/nodes
    CREATE (source)-[:REPOSTED {timestamp: row.timestamp_ms}]->(target)
    """
    tx.run(query, batch=batch_data)

# --- Main Ingestion Logic ---
def main():
    print("--- Starting Data Ingestion ---")

    if not os.path.exists(SOURCE_DATA_PATH):
        print(f"ERROR: Source data file not found at: {SOURCE_DATA_PATH}")
        sys.exit(1)

    try:
        print(f"Loading data from: {SOURCE_DATA_PATH}")
        df = pd.read_pickle(SOURCE_DATA_PATH)
        print(f"Loaded {len(df)} records.")
        print(f"DataFrame columns: {df.columns}") # Print columns for verification

        # *** MODIFIED VALIDATION ***
        required_columns = {'channel_from_id', 'channel_id', 'publish_datetime'}
        if not required_columns.issubset(df.columns):
             missing = required_columns - set(df.columns)
             print(f"ERROR: Data file is missing required columns: {missing}")
             sys.exit(1)
        else:
            print("Required columns found.")

    except Exception as e:
        print(f"ERROR: Failed to load or validate data file: {e}")
        sys.exit(1)

    # 3. Prepare data for Neo4j
    try:
        data_for_neo4j = []
        processed_count = 0
        skipped_count = 0
        print("Preparing data for Neo4j...")
        for index, row in df.iterrows():
            # *** MODIFIED COLUMN ACCESS ***
            source_id = row['channel_from_id']
            target_id = row['channel_id']
            publish_dt = row['publish_datetime']

            # Basic check for missing essential data for a relationship
            if pd.isna(source_id) or pd.isna(target_id) or pd.isna(publish_dt):
                skipped_count += 1
                # Optional: Log skipped rows
                # print(f"Skipping row {index}: Missing source_id, target_id, or publish_datetime")
                continue # Skip this row if essential data is missing

            timestamp_ms = datetime_to_ms_epoch(publish_dt)
            if timestamp_ms is None: # Check if conversion failed
                 skipped_count += 1
                 continue

            data_for_neo4j.append({
                'source_id': str(source_id), # Ensure string
                'target_id': str(target_id), # Ensure string
                'timestamp_ms': timestamp_ms
            })
            processed_count += 1

        print(f"Data preparation complete. Processed: {processed_count}, Skipped (missing data): {skipped_count}")
        if processed_count == 0 and skipped_count > 0:
             print("ERROR: No valid rows found to process after checking for missing data.")
             sys.exit(1)
        elif processed_count == 0:
             print("WARNING: No rows found in the input data file.")
             # Decide if this is an error or just an empty file scenario
             # sys.exit(1) # Uncomment to treat as error


    except Exception as e:
        print(f"ERROR: Failed during data preparation: {e}")
        sys.exit(1)


    # 4. Connect to Neo4j and run ingestion
    driver = None
    try:
        print(f"Connecting to Neo4j at {NEO4J_URI}...")
        driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
        driver.verify_connectivity()
        print("Successfully connected to Neo4j.")

        with driver.session(database="neo4j") as session: # Use default database 'neo4j' unless specified otherwise
            # *** UPDATED API CALL ***
            session.execute_write(create_constraints_indexes)

            # Ingest data in batches
            batch_size = 1000 # Adjust batch size based on memory/performance
            print(f"Ingesting {len(data_for_neo4j)} prepared records in batches of {batch_size}...")
            if not data_for_neo4j:
                 print("No data to ingest.")
            else:
                for i in range(0, len(data_for_neo4j), batch_size):
                    batch = data_for_neo4j[i:i + batch_size]
                    # *** UPDATED API CALL ***
                    session.execute_write(ingest_data_batch, batch)
                    # Simple progress indicator for large files
                    processed_records = min(i + batch_size, len(data_for_neo4j))
                    print(f"  Processed records {processed_records}/{len(data_for_neo4j)}...")

            print("Data ingestion completed successfully.")

    except Exception as e:
        print(f"ERROR: An error occurred during Neo4j interaction: {e}")
        sys.exit(1)
    finally:
        if driver:
            driver.close()
            print("Neo4j connection closed.")

    print("--- Data Ingestion Finished ---")

if __name__ == "__main__":
    main()