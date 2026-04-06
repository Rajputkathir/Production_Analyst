<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/0d61fb8e-2239-4a94-8534-e5066502cb9f

## Run Locally

**Prerequisites:**  Node.js, PostgreSQL


1. Install dependencies:
   `npm install`
2. Create a `.env` file and set:
   - `GEMINI_API_KEY`
   - `DATABASE_URL` for your PostgreSQL database, or the `PG*` variables shown in [.env.example](.env.example)
3. Run the app:
   `npm run dev`

## SQLite Migration

To copy the existing [`production_analyst.db`](/C:/Users/Ctcbein088/Downloads/New%20folder%20(4)/Testing%202/production_analyst.db) data into PostgreSQL:

1. Point `.env` at the target PostgreSQL database.
2. Run `npm run migrate`.
3. If the target PostgreSQL database already contains data, run `npm run migrate -- --reset`.
