
## Prerequisites

*   Python 3.7+
*   Neo4j Community Edition (Neo4j Desktop recommended for easy management)
*   Git
*   (Optional) Node.js and npm/yarn (if you plan to manage frontend dependencies this way)

## Setup & Installation

1.  **Clone the Repository:**
    ```bash
    git clone https://github.com/your-username/temporal-graph-vis.git
    cd temporal-graph-vis
    ```

2.  **Create and Activate Python Virtual Environment:**
    ```bash
    python -m venv venv
    # On Windows:
    .\venv\Scripts\activate
    # On macOS/Linux:
    source venv/bin/activate
    ```

3.  **Install Python Dependencies:**
    ```bash
    pip install -r backend/requirements.txt
    ```

4.  **Configure Environment Variables:**
    *   Copy `.env.example` to `.env`:
        ```bash
        # On Windows (CMD):
        copy .env.example .env
        # On Windows (PowerShell):
        Copy-Item .env.example .env
        # On macOS/Linux:
        cp .env.example .env
        ```
    *   Edit the `.env` file with your specific settings:
        *   `NEO4J_URI`: (e.g., `neo4j://localhost:7687`)
        *   `NEO4J_USER`: (e.g., `neo4j`)
        *   `NEO4J_PASSWORD`: Your Neo4j database password.
        *   `SOURCE_DATA_PATH`: Path to your source data file (e.g., `data/sample_reposts.pkl` or your own data file).
        *   `FLASK_HOST`: (e.g., `0.0.0.0` to allow access from other devices on your LAN).
        *   `FLASK_PORT`: (e.g., `5000`).

5.  **Prepare Source Data:**
    *   Ensure your source data file (e.g., a `.pkl` file containing a Pandas DataFrame) is in the location specified by `SOURCE_DATA_PATH` in your `.env` file.
    *   The DataFrame should have columns like `source_channel_id`, `target_channel_id`, and `publish_datetime` (datetime objects, preferably timezone-aware UTC, or parseable date strings).
    *   A `data/sample_reposts.pkl` is provided for testing.

6.  **Ingest Data into Neo4j:**
    *   Make sure your Neo4j database instance is running.
    *   Run the ingestion script:
        ```bash
        python scripts/ingest_data.py
        ```
    *   This will create necessary constraints, indexes, nodes, and relationships in Neo4j.

7.  **Configure Firewall (Server PC):**
    *   Allow incoming TCP connections on the `FLASK_PORT` (e.g., 5000) in your server PC's firewall settings so other devices on your local network can access the application.

## Running the Application

1.  **Start Neo4j Database:** Ensure your Neo4j instance is running.

2.  **Run the Flask Application (Server):**
    *   Make sure your Python virtual environment is activated (`source venv/bin/activate` or `.\venv\Scripts\activate`).
    *   **Development Server (for testing):**
        ```bash
        # Ensure FLASK_APP and FLASK_DEBUG are set if needed, or run directly:
        python backend/app.py
        ```
    *   **Production WSGI Server (Recommended):**
        *   **Gunicorn (Linux/macOS):**
            ```bash
            gunicorn --bind ${FLASK_HOST}:${FLASK_PORT} backend.app:app
            ```
        *   **Waitress (Windows/Cross-platform):**
            ```bash
            waitress-serve --host ${FLASK_HOST} --port ${FLASK_PORT} backend.app:app
            ```
        (Replace `${FLASK_HOST}` and `${FLASK_PORT}` with values from your `.env` or directly, e.g., `0.0.0.0:5000`)

3.  **Access the Application (Client):**
    *   Open a web browser on any computer on the same local network.
    *   Navigate to `http://<SERVER_PC_IP_ADDRESS>:<PORT>/` (e.g., `http://192.168.1.101:5000/`). Replace `<SERVER_PC_IP_ADDRESS>` with the actual local IP address of the computer running the Flask server, and `<PORT>` with the `FLASK_PORT`.

## Contributing

Contributions are welcome! Please feel free to submit a pull request or open an issue for bugs, feature requests, or improvements.

*(Consider adding a "Future Enhancements" or "Known Limitations" section if you have specific ideas).*

## License

*(Consider adding a license, e.g., MIT License. If so, create a `LICENSE` file in your repository.)*
This project is licensed under the MIT License - see the `LICENSE` file for details.
