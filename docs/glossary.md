# WeStamp — Glossary

Plain-English definitions of technical terms used in this project.
If you see a word you don't understand, check here first.

Last updated: 2026-03-21

---

## General Terms

**API (Application Programming Interface)**
A way for two pieces of software to talk to each other. When the website needs data from the database, it sends a request to the API, and the API sends back a response. Think of it like a waiter taking your order to the kitchen and bringing back your food.

**Backend**
The part of the app you can't see. It handles data, calculations, and business logic. In WeStamp, the backend calculates stamp duty, generates PDFs, and talks to the database.

**Frontend**
The part of the app you can see — the website pages, buttons, and forms.

**Full-stack**
When one application handles both frontend and backend. WeStamp uses Next.js, which is a full-stack framework.

**MVP (Minimum Viable Product)**
The smallest version of the product that is useful to real users. We build only what's essential, then improve based on feedback.

**Monorepo**
A single code repository that contains multiple projects. We are NOT using a monorepo — WeStamp is a single Next.js project.

---

## Technical Tools

**Node.js**
The engine that runs our application code. Written in JavaScript/TypeScript.

**npm (Node Package Manager)**
A tool that downloads code libraries. When our project needs a PDF generation tool, npm downloads it for us.

**Next.js**
A framework (a pre-built structure) for building websites. It handles both the pages users see and the API endpoints the pages talk to. Made by Vercel.

**React**
A library for building user interfaces. Next.js is built on top of React.

**TypeScript**
A version of JavaScript with added type safety. It catches mistakes before the code runs. Think of it like spell-check for code.

**Tailwind CSS**
A styling tool that lets us make the website look good using pre-built CSS classes. Instead of writing custom styles, we use short class names like "bg-blue-500" (blue background).

**Prisma**
A tool that lets us work with the database in plain TypeScript instead of writing raw SQL queries. It also manages changes to the database structure.

**PostgreSQL (Postgres)**
A database — software that stores and retrieves structured data (user accounts, agreements, payments). Like a very powerful spreadsheet that code can query.

**Git**
A version control tool. It tracks every change made to the code, who made it, and when. If something breaks, we can go back to a working version.

**VS Code (Visual Studio Code)**
A free code editor made by Microsoft. It's where you view and edit code files.

---

## Authentication Terms

**Authentication (Auth)**
Verifying who a user is. "Logging in" is authentication.

**JWT (JSON Web Token)**
A secure token (a long encoded string) that proves a user is logged in. After you log in, the server gives you a JWT, and you send it with every request so the server knows it's you.

**NextAuth.js**
A library that handles sign-up, login, and session management for Next.js apps. Saves us from building authentication from scratch.

**Session**
The period between when a user logs in and logs out. During a session, the user doesn't need to re-enter their password on every page.

---

## Database Terms

**Schema**
The structure of the database — what tables exist, what columns each table has, and what type of data goes in each column. Like the column headers in a spreadsheet.

**Migration**
A controlled change to the database schema. Instead of manually editing the database, we write a migration file that describes the change, and Prisma applies it.

**Model**
A definition of a database table in code. In Prisma, a model describes a table's columns and relationships.

---

## Payment Terms

**Billplz**
A Malaysian payment gateway. It lets WeStamp accept payments from users. Supports FPX.

**FPX (Financial Process Exchange)**
Malaysia's online banking payment system. Users pay by logging into their bank's online banking. Most Malaysian consumers prefer this over credit cards.

**Payment gateway**
A service that processes payments. It sits between the user's bank and WeStamp. We never handle card numbers or bank credentials directly.

---

## Document Terms

**PDF (Portable Document Format)**
A file format that looks the same on every device. WeStamp generates tenancy agreements as PDFs.

**SHA-256 hash**
A digital fingerprint of a file. If even one character in the file changes, the hash changes completely. Used to detect tampering — if the hash of the signed document doesn't match the original hash, someone has altered it.

**Digital signature vs. electronic signature**
A digital signature uses cryptographic certificates (like those from a Certificate Authority). An electronic signature is broader — it includes typed names, drawn signatures, and other methods of indicating agreement. WeStamp uses electronic signatures with audit trails in the MVP.

---

## WeStamp-Specific Terms

**e-Duti Setem**
LHDN's current online portal for stamp duty assessment and payment. This is where WeStamp's admin team submits documents for stamping.

**MyTax**
LHDN's taxpayer portal. e-Duti Setem is accessed through MyTax.

**LHDN (Lembaga Hasil Dalam Negeri)**
Malaysia's Inland Revenue Board. The government agency that handles tax, including stamp duty.

**STAMPS**
LHDN's legacy (older) online stamping system. Has been replaced by e-Duti Setem via MyTax. Background reference only.

**Stamp duty**
A tax paid on certain legal documents to make them legally valid. For tenancy agreements, the amount depends on the annual rent and lease term.

**Stamp certificate**
The official certificate from LHDN confirming that stamp duty has been paid. In the MVP, admin downloads this from e-Duti Setem and uploads it into WeStamp.

**Manual review**
When a document or calculation doesn't fit the standard supported rules, a human (admin) reviews it instead of the system processing it automatically.

---

## Infrastructure Terms

**Vercel**
A hosting platform for Next.js apps. Deploys the website so users can access it online. Has a free tier.

**Railway**
A hosting platform for databases and backend services. We use it to host PostgreSQL in production.

**Environment variable**
A secret setting (like a password or API key) stored outside the code. Kept in a `.env.local` file that is never uploaded to the internet.

**Deployment**
The process of putting the application online so real users can access it. During development, the app runs only on your computer.

---

## Legal/Compliance Terms

**PDPA (Personal Data Protection Act 2010)**
Malaysia's data protection law. Governs how businesses collect, store, use, and share personal data.

**Privacy Notice**
A document telling users what personal data you collect, why, and how you protect it. Required under PDPA.

**Audit log**
A record of who did what and when. Used for accountability and compliance. WeStamp logs all admin actions and file access events.
