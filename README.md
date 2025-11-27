# web2050

> The AI-Generated web.

Append any URL to the base URL (after `/`, minus the protocol) and it will live-stream generate that specific page! Subsequently, your browser uses it to recursively generate the rest of the site, including all assets, pages, and JS! Uses [https://ai.hackclub.com](https://ai.hackclub.com) internally.

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
```

- `HOST`: The address and port to bind the server to (format: `IP:PORT` or just `IP` to use default port 3000).

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
3. The server will stream the generated content and save it to the `internet/` directory for future requests.
4. You can search locally generated pages using the search bar on the home page.
