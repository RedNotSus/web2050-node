# web2050

> The AI-Generated web.

Append any URL to the base URL (after `/`, minus the protocol) and it will live-stream generate that specific page! Subsequently, your browser uses it to recursively generate the rest of the site, including all assets, pages, and JS! Uses [https://ai.hackclub.com](https://ai.hackclub.com) internally. all credits to elijah629/web2050 he did basically all of it

## Why?

To show that 2-shot vibecoding a webpage is not a good idea 💀

## Security

The Content Security Policy (CSP) disallows all external assets, and the AI has been prompted to follow Hack Club Nest's Code of Conduct.

## Demo

Demo available [here](https://ai.dino.icu)

## Self-Hosting

### Prerequisites

- **Node.js** (v18 or higher recommended)
- **pnpm** (Package manager)
- **PostgreSQL** (Database)

### Installation

1. Clone the repository.
2. Install dependencies:

   ```sh
   pnpm install
   ```

### Configuration

Create a `.env` file in the root directory if it doesn't exist:

```env
HOST=0.0.0.0:8000
API_KEY=your_api_key_here
MODEL=qwen/qwen3-32b

# Database Configuration
# Primary method: Use a connection string
DATABASE_URL=postgresql://postgres:password@localhost:5432/web2050
```

- `HOST`: The address and port to bind the server to (format: `IP:PORT` or just `IP` to use default port 3000).
- `API_KEY`: Your API key for the AI service.
- `MODEL`: The model ID to use (e.g., `qwen/qwen3-32b`).
- `DATABASE_URL`: The PostgreSQL connection string.
  - Alternatively, you can use standard `libpq` environment variables (`PGHOST`, `PGUSER`, `PGDATABASE`, `PGPASSWORD`, `PGPORT`).

### Running the Server

Start the server:

```sh
pnpm start
```

The server will be available at the address specified in `HOST` (e.g., `http://localhost:8000`).

### Usage

1. Open your browser and navigate to the server URL.
2. To generate a page, append the desired domain and path to the URL.
   - Example: `http://localhost:8000/google.com/index.html`
3. The server will stream the generated content and save it to the database for future requests.
4. You can search locally generated pages using the search bar on the home page.

### API

#### Reset Page

To delete a generated page (so it can be regenerated on the next visit), send a POST request:

**Endpoint:** `POST /reset`

**Body:**
```json
{
  "path": "google.com/index.html"
}
```
