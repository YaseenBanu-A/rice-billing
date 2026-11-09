# Aamina Boutique Collections — Billing

Billing for **Aamina Boutique Collections** (owner: Shifna · 7338772521 · Pulinthope, Chennai): manual-entry bills, boutique invoices (A4, A5, 80mm receipt), PDF and printing.
Several people can use it at once from any phone or computer. Bills, payments and stock update on every open screen instantly.

| Part | Technology |
| --- | --- |
| App (frontend) | React 19, TypeScript, Tailwind CSS, Vite (`src/`) |
| Server (backend) | Node.js, Express 5 REST API, Socket.IO (`server/`) |
| Database | PostgreSQL through Prisma ORM (`prisma/`) |
| Shared | GST and totals maths and permissions, used by both sides (`shared/`) |
| Hosting | Render: one web service plus one PostgreSQL database (`render.yaml`) |

## What it does

The app is the original billing screen set: **Dashboard, Create Bill, Bills History and Settings**, with the same design and the same billing calculations. Behind it there is now a proper server and database:

- All bills, customers and settings are stored permanently in PostgreSQL, so nothing depends on the browser.
- Several people can bill at once from any phone or computer. A bill made on one counter appears on every other open screen without refreshing.
- Each person signs in with their own username and password.
- The server assigns invoice numbers (`INV-001`, `INV-002`, …) inside a database transaction, so they are never duplicated, even when two counters save at the same moment. A double click or a retry saves the bill once.
- The server recalculates every total and GST amount and records who did what (activity log).

The server also contains APIs for stock, purchases, suppliers, expenses, reports and user management (see API below). They are not shown in the app.

## Run it on your computer

Needs **Node.js 22.12 or newer**.

```bash
npm install
cp .env.example .env        # then fill in DATABASE_URL, ADMIN_PASSWORD and JWT_SECRET
npm run db:local            # local PostgreSQL on port 5433 (no install needed); keep it running
npm run db:deploy           # create the tables (in a second terminal)
npm run dev                 # app at http://localhost:5173, API at http://localhost:3001
```

On first start the server creates the shop settings for Aamina Boutique Collections, the GST rates, and the administrator from `ADMIN_USERNAME` / `ADMIN_PASSWORD` in `.env`. The database starts empty: no sample data.

**Forgot a password?** Run `npm run user:reset-password -- admin` (on Render: web service → Shell). It prints a new random password and signs that user out everywhere.

To run it the way it runs online: `npm run build` and then `npm start` (one address, http://localhost:3001).

### Settings (environment variables)

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string. Locally, `npm run db:local` creates its database with the login, port and name given here (and a `_test` copy for the tests) |
| `JWT_SECRET` | production | Long random string (32+ characters) that signs sign-in tokens |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | first start | First administrator. Only used while there are no users |
| `TZ` | – | Shop time zone for "today" and date filters. Default `Asia/Kolkata` |
| `PORT`, `HOST` | – | Default `3001`; `127.0.0.1` locally, `0.0.0.0` in production |
| `CORS_ORIGINS` | – | Only if the app is hosted on a different address from the API (comma-separated) |
| `VITE_API_URL` | – | Build-time setting, same case: the API address for a separately hosted app |
| `ACCESS_TOKEN_TTL_SEC`, `REFRESH_TOKEN_TTL_DAYS` | – | Session lengths. Defaults are 15 minutes and 30 days |

Secrets live only in environment variables: never in the code, never in the app the browser downloads.

## Put it online (Render)

1. Push this project to a **private** GitHub repository.
2. On [render.com](https://render.com): **New → Blueprint**, then choose the repository. Render reads `render.yaml` and creates:
   - **aj-rice-db**: PostgreSQL in Singapore, the region closest to Tamil Nadu. It is reachable only from inside Render.
   - **aj-rice-billing**: the web service. It gets `DATABASE_URL` (the internal connection), a generated `JWT_SECRET` and `TZ=Asia/Kolkata` automatically.
3. Render asks for **ADMIN_PASSWORD**: type the administrator's password (8+ characters). It is stored only in Render's settings, never in the code.
4. When the deploy finishes, open `https://aj-rice-billing.onrender.com` and sign in with username `admin` and that password.

Every deploy runs `npm ci && npm run build`, and then `npm start`. The start step applies any new database migrations (`prisma migrate deploy` only ever moves forward and is safe to repeat) before the server starts.

**Plans:** the blueprint uses the paid **basic-256mb** database. It keeps data permanently and comes with Render's daily backups. Render's free database is deleted after 30 days, so it is not suitable for business records. The web service uses **starter**. `free` also works but sleeps after 15 idle minutes, and the first visit after that takes about a minute.

## Backups

- **Render:** daily automatic backups of the paid database (Dashboard → aj-rice-db → Recovery).
- **In the app:** Settings → Backup downloads everything except passwords as one file. **Restore** replaces all data with such a file. It also imports backups from the earlier single-computer version of this app.

## How the data is protected

- **Totals and GST:** the server recalculates every total, GST, balance and status. Figures sent by the browser are ignored.
- **Transactions:** a bill's number, lines, stock change, payment and activity-log entry are saved together or not at all. The same applies to purchases, payments, returns and cancellations.
- **Simultaneous use:**
  - Stock checks and changes are a single database statement, so two counters can't both sell the last bag.
  - Each bill carries a version, so an edit made from an out-of-date screen is refused instead of overwriting someone else's change.
- **No duplicates:** every new bill, payment, purchase and expense carries a one-time key. A double click or a retry after a network drop is saved only once.
- **History:** bills keep their own copy of names, prices and customer details. Products used on bills are archived rather than deleted.
- **Sign-in:**
  - Passwords are hashed with scrypt.
  - Access tokens are short-lived JWTs held only in memory. Refresh tokens are rotating HttpOnly cookies, and reusing an old one signs that device out.
  - Login attempts are rate limited.
  - Deactivating a user or changing a password signs them out everywhere at once.
- **Web security:**
  - Helmet security headers with a strict Content Security Policy.
  - Same-origin by default; CORS is opt-in.
  - A required app header on every change (CSRF protection) and API rate limiting.
  - Prisma's parameterised queries block SQL injection.
- **Database rules:** PostgreSQL itself enforces foreign keys, unique invoice numbers, and check constraints such as no negative quantities or amounts.

## Tests

```bash
npm run db:local   # in another terminal
npm test
```

The test suite runs the real server against a separate `ajrice_test` database. It covers:
- sign-in, token refresh and reuse detection, roles and permissions;
- customers, products, suppliers and purchases;
- invoice GST maths, stock deduction and duplicate submissions;
- 10 simultaneous bills;
- short stock, partial payments, edit conflicts, returns and cancellations;
- reports, the activity log, live updates over Socket.IO;
- data surviving a server restart, and backup/restore.

## Project layout

```
prisma/              schema.prisma and migrations
server/
  index.ts           start-up: database check, first admin, HTTP and Socket.IO
  app.ts             Express app: security middleware, routes, built app
  realtime.ts        Socket.IO: signed-in screens, live change notices, who's online
  middleware/        auth (JWT, permissions), security (helmet, CORS, rate limits), errors, request log
  lib/               validation, numbering, stock changes, audit log, logger
  modules/<area>/    routes.ts, controller.ts, service.ts for auth, users, settings, customers,
                     suppliers, products, inventory, invoices (bills, payments, returns),
                     purchases, expenses, reports, admin (bootstrap, backup)
shared/              types, GST maths, permissions, company defaults
src/                 React app (pages/, components/, lib/api.ts, lib/live.ts)
tests/               API tests
```

## API

All endpoints are under `/api`. Every one except `/health` and `/auth/*` needs `Authorization: Bearer <access token>`, and any request that changes data needs the header `X-Requested-With: ajrice`. Errors look like `{ "error": "message", "code"?: "...", "fields"?: { "field": "message" } }`.

| Area | Endpoints |
| --- | --- |
| Auth | `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/password`; `GET /auth/me` |
| Start-up | `GET /bootstrap` (settings, tax rates, products, customers, categories, next invoice number) |
| Settings | `GET/PUT /settings`; `GET/POST /tax-rates`, `PUT/DELETE /tax-rates/:id` |
| Users | `GET/POST /users`, `PUT /users/:id`, `GET /audit-log` |
| Customers / suppliers | `GET/POST /customers`, `GET/PUT/DELETE /customers/:id`; the same for `/suppliers` |
| Products | `GET/POST /products`, `GET/PUT/DELETE /products/:id`; `GET/POST /categories`, `PUT/DELETE /categories/:id` |
| Inventory | `GET /inventory/movements`, `GET /inventory/summary`, `POST /inventory/adjustments` |
| Bills | `GET /bills?q=&status=&from=&to=&customerId=&limit=&offset=`, `GET /bills/:id`, `POST /bills`, `PUT /bills/:id`, `DELETE /bills/:id`, `GET /invoices/next`, `GET /bills/item-names` |
| Payments, returns | `POST /bills/:id/payments`, `POST /bills/:id/returns`, `POST /bills/:id/cancel`, `DELETE /payments/:id` |
| Purchases | `GET/POST /purchases`, `GET /purchases/:id`, `GET /purchases/next`, `POST /purchases/:id/payments`, `POST /purchases/:id/cancel` |
| Expenses | `GET/POST /expenses`, `PUT/DELETE /expenses/:id`, `GET /expenses/categories` |
| Reports | `GET /reports/dashboard`, `GET /reports/summary?from=&to=` |
| Data | `GET /backup`, `POST /restore`, `POST /reset` (body `{ "confirm": "RESET" }`) |
#   r i c e - b i l l i n g 
 
 #   a a m i n a b o u t i q u e  
 