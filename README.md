# INVICTUS 2026 – deploy package

Features:
- Public registration form
- Registration confirmation page with ID, team name, and team leader
- Mobile-friendly admin login and dashboard
- Edit registrations
- Excel (.xlsx) export
- PDF export
- PostgreSQL storage with Render SSL
- Cookie-based admin session (works better on mobile and survives app restarts when ADMIN_SESSION_SECRET is set)

## Local
1. `npm install`
2. Copy `.env.example` to `.env`
3. Set `DATABASE_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and a long random `ADMIN_SESSION_SECRET`.
4. `npm start`
5. Open `http://localhost:3000`
6. Admin: `http://localhost:3000/admin/login`

## Render
Set the same environment variables in the Render service. Do not commit `.env`.
Build: `npm install`
Start: `npm start`
