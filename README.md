# ILGC Traffic Network Simulator (Full Stack)

This repository contains the full stack implementation of the ILGC Traffic Network Simulator. It is structured into two main packages: frontend and backend.

## Project Structure

```
simulator-frontend-backend/
├── frontend/             # React + Vite frontend simulator application
└── backend/              # Java Spring Boot backend application
```

---

## Frontend Setup (`/frontend`)

The frontend is a React application built with Vite, React Flow, Chart.js, and Leaflet.

### Prerequisites
- Node.js (v18 or higher recommended)
- npm (Node Package Manager)

### Commands
1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the development server:
   ```bash
   npm run dev
   ```
4. Build the application:
   ```bash
   npm run build
   ```

---

## Backend Setup (`/backend`)

The backend is a Java Spring Boot application built with Maven.

### Prerequisites
- Java Development Kit (JDK) 17 or higher
- Maven (installed, or use Maven Wrapper if set up)

### Commands
1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Run the application (using Maven):
   ```bash
   mvn spring-boot:run
   ```
3. Build the application:
   ```bash
   mvn clean package
   ```
