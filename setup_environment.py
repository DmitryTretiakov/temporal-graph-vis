import os
import sys
import subprocess
import time
import argparse
import shutil
from dotenv import load_dotenv

try:
    import docker
    from docker.errors import DockerException
except ImportError:
    print("ERROR: 'docker' library not found. Please install it:")
    print("pip install docker")
    sys.exit(1)

# --- Configuration ---
PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
DOTENV_PATH = os.path.join(PROJECT_ROOT, '.env')
NEO4J_DATA_DIR = os.path.join(PROJECT_ROOT, 'neo4j', 'data')
NEO4J_LOGS_DIR = os.path.join(PROJECT_ROOT, 'neo4j', 'logs')
DOCKER_COMPOSE_FILE = os.path.join(PROJECT_ROOT, 'docker-compose.yml')
INGESTION_SCRIPT = os.path.join(PROJECT_ROOT, 'scripts', 'ingest_data.py')
# Use the python interpreter from the current virtual environment
PYTHON_EXECUTABLE = sys.executable

# Load environment variables (needed for potential future use, good practice)
load_dotenv(dotenv_path=DOTENV_PATH)

# --- Helper Functions ---

def print_step(message):
    print(f"\n>>> {message}")

def print_info(message):
    print(f"    {message}")

def print_error(message):
    print(f"ERROR: {message}", file=sys.stderr)

def check_docker_running():
    """Checks if the Docker daemon is running and accessible."""
    print_step("Checking Docker status...")
    try:
        client = docker.from_env()
        client.ping()
        print_info("Docker daemon is running.")
        return True
    except DockerException:
        print_error("Docker daemon is not running or accessible.")
        print_error("Please start Docker Desktop or the Docker service.")
        return False
    except Exception as e:
        print_error(f"An unexpected error occurred while checking Docker: {e}")
        return False

def ensure_docker_volumes_exist():
    """Creates the host directories needed for Neo4j volumes."""
    print_step("Ensuring host directories for Neo4j volumes exist...")
    try:
        os.makedirs(NEO4J_DATA_DIR, exist_ok=True)
        os.makedirs(NEO4J_LOGS_DIR, exist_ok=True)
        print_info(f"Directory ensured: {NEO4J_DATA_DIR}")
        print_info(f"Directory ensured: {NEO4J_LOGS_DIR}")
    except OSError as e:
        print_error(f"Failed to create volume directories: {e}")
        sys.exit(1)

def run_docker_compose(args, action_desc):
    """Runs a docker-compose command."""
    if not os.path.exists(DOCKER_COMPOSE_FILE):
        print_error(f"docker-compose.yml not found at: {DOCKER_COMPOSE_FILE}")
        sys.exit(1)

    command = ['docker-compose'] + args
    print_info(f"Running: {' '.join(command)}")
    try:
        # Use check=True to raise CalledProcessError if command fails
        subprocess.run(command, check=True, cwd=PROJECT_ROOT, capture_output=True, text=True)
        print_info(f"Docker Compose action '{action_desc}' successful.")
        return True
    except FileNotFoundError:
        print_error("'docker-compose' command not found. Is Docker Compose installed and in your PATH?")
        return False
    except subprocess.CalledProcessError as e:
        print_error(f"Docker Compose action '{action_desc}' failed.")
        print_error(f"Return Code: {e.returncode}")
        print_error(f"Stderr: {e.stderr}")
        print_error(f"Stdout: {e.stdout}")
        return False
    except Exception as e:
        print_error(f"An unexpected error occurred running docker-compose: {e}")
        return False

def clear_neo4j_data():
    """Stops Neo4j container, removes data volume contents, restarts."""
    print_step("Clearing existing Neo4j data...")
    if not run_docker_compose(['down'], 'stop container'):
        print_error("Failed to stop Neo4j container. Aborting clear.")
        return False # Indicate failure

    print_info(f"Removing contents of Neo4j data directory: {NEO4J_DATA_DIR}")
    if os.path.exists(NEO4J_DATA_DIR):
        try:
            # Remove the directory and its contents, then recreate it
            shutil.rmtree(NEO4J_DATA_DIR)
            os.makedirs(NEO4J_DATA_DIR, exist_ok=True)
            print_info("Data directory cleared and recreated.")
        except Exception as e:
            print_error(f"Failed to clear data directory: {e}")
            return False # Indicate failure
    else:
        print_info("Data directory does not exist, nothing to clear.")

    # No need to restart here, the main flow will start it
    return True # Indicate success

def start_neo4j():
    """Starts the Neo4j container using docker-compose up -d."""
    print_step("Starting Neo4j container...")
    if not run_docker_compose(['up', '-d'], 'start container'):
        return False # Indicate failure

    print_info("Waiting for Neo4j container to initialize (approx. 15-30 seconds)...")
    # This is a simple wait. A more robust solution would poll the Bolt port or check container health.
    time.sleep(20) # Adjust sleep time if needed
    print_info("Neo4j should be ready.")
    return True # Indicate success

def stop_neo4j():
    """Stops the Neo4j container using docker-compose down."""
    print_step("Stopping Neo4j container...")
    run_docker_compose(['down'], 'stop container')

def run_ingestion():
    """Runs the data ingestion script."""
    print_step("Running data ingestion script...")
    if not os.path.exists(INGESTION_SCRIPT):
        print_error(f"Ingestion script not found at: {INGESTION_SCRIPT}")
        return False

    command = [PYTHON_EXECUTABLE, INGESTION_SCRIPT]
    print_info(f"Running: {' '.join(command)}")
    try:
        # Run ingestion script, inherit stdio to see its output directly
        process = subprocess.run(command, check=True, cwd=PROJECT_ROOT)
        print_info("Ingestion script completed successfully.")
        return True
    except subprocess.CalledProcessError as e:
        print_error(f"Ingestion script failed with return code {e.returncode}.")
        return False
    except Exception as e:
        print_error(f"An unexpected error occurred running ingestion script: {e}")
        return False

# --- Main Execution ---
def main():
    parser = argparse.ArgumentParser(description="Setup Neo4j Docker environment and ingest data.")
    parser.add_argument(
        '--clear',
        action='store_true',
        help="Clear existing Neo4j data before starting and ingesting."
    )
    parser.add_argument(
        '--stop',
        action='store_true',
        help="Stop the Neo4j container after ingestion is complete."
    )
    args = parser.parse_args()

    print("=============================================")
    print("=== Temporal Graph Env Setup & Ingestion ===")
    print("=============================================")

    if not check_docker_running():
        sys.exit(1)

    ensure_docker_volumes_exist()

    neo4j_started_successfully = False
    if args.clear:
        if clear_neo4j_data():
            # Start Neo4j after clearing
            neo4j_started_successfully = start_neo4j()
        else:
            print_error("Aborting due to failure during data clearing.")
            sys.exit(1)
    else:
        # Just ensure Neo4j is started if not clearing
        neo4j_started_successfully = start_neo4j()

    if not neo4j_started_successfully:
        print_error("Failed to start Neo4j container. Aborting.")
        sys.exit(1)

    # Run ingestion only if Neo4j started successfully
    ingestion_successful = run_ingestion()

    if args.stop:
        stop_neo4j()
    else:
        print_info("\nNeo4j container is left running.")
        print_info("You can stop it manually using: docker-compose down")

    if ingestion_successful:
        print("\n--- Setup and Ingestion Process Completed Successfully ---")
    else:
        print("\n--- Setup and Ingestion Process Finished with Errors ---")
        sys.exit(1)


if __name__ == "__main__":
    main()