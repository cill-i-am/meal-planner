# Tesco API Facade

Effect v4 beta Node API for typed, read-only Tesco calls.

## Endpoints

- `GET /health`
- `GET /tesco/search?query=milk&page=1&count=24&sortBy=relevance`
- `POST /tesco/search`
- `GET /tesco/categories/:facet/products?page=1&count=24&sortBy=relevance`
- `POST /tesco/categories/:facet/products`
- `GET /tesco/suggestions?query=milk&limit=10`
- `POST /tesco/graphql`

`/tesco/graphql` is a typed escape hatch for reverse-engineering new operations. Keep it read-only unless a mutation has been explicitly reviewed.

## Environment

Export the required variables in the shell before starting the app. The app reads process env through Effect Config and does not load `.env` files.

- `HOST`
- `PORT`
- `TESCO_MANGO_URL`
- `TESCO_SUGGESTION_URL`
- `TESCO_LOCALE`
- `TESCO_REGION`
- `TESCO_MANGO_API_KEY`
- `TESCO_AUTHORIZATION`

Optional Tesco headers:

- `TESCO_TRANSACTION_PURPOSE`
- `TESCO_RELEASE_BRANCH`

Auth refresh is not implemented yet. A Tesco `401` is returned as an upstream auth failure.

## Source Layout

- `src/domain/tesco`: pure Tesco request/response contracts and schema normalizers.
- `src/application`: app config, error taxonomy, and ports.
- `src/infrastructure/tesco`: concrete Tesco auth state and XAPI/GraphQL adapter.
- `src/interfaces/http`: HTTP routes, query parsing, and response rendering.
- `src/main.ts`: composition root that wires Effect layers together.
