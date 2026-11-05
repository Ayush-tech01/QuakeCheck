# 🌍 QuakeCheck
### Earthquake Emergency & Rescue Coordination System

QuakeCheck is a full-stack, location-based earthquake emergency and rescue coordination platform designed to support disaster response activities. It provides a centralized environment for emergency reporting, real-time monitoring, rescue team coordination, and shelter navigation.

The platform connects citizens, administrators, and rescue teams through dedicated dashboards and real-time communication. It also incorporates analytical features to provide additional earthquake-related insights and support informed administrative decisions

---

## 🏗️ System Architecture

QuakeCheck follows a modular architecture consisting of a React frontend, Node.js backend, and independent Python services for routing and machine learning.

```text
                    QUAKCHECK
                        |
          +-------------+-------------+
          |             |             |
       Frontend      Backend       Python Services
          |             |             |
        React        Node.js       +---+---+
        Vite         Express       |       |
        Tailwind     MongoDB     Routing   ML
          |          Socket.IO   FastAPI  Flask
          |          JWT         NetworkX Scikit-learn
          |                       |       |
          +-----------------------+-------+
```

### Main Components

| Component | Description |
|---|---|
| Frontend | React-based interface for citizens, administrators, and rescue teams. |
| Backend | Node.js and Express REST APIs for application logic and data management. |
| Database | MongoDB for storing users, emergencies, rescue teams, shelters, and earthquake information. |
| Routing Service | Python FastAPI service for route calculation and navigation. |
| ML Service | Python Flask service providing earthquake severity analysis and historical similarity retrieval. |
| Real-Time Communication | Socket.IO for emergency notifications, assignment updates, and location sharing. |

---

## ✨ Key Features

### 🌍 1. Earthquake Monitoring
- Displays earthquake information through an interactive map.
- Provides geographical visualisation of earthquake events.
- Presents relevant earthquake information to users.

### 🛡️ 2. Citizen Emergency Features

The platform provides two primary emergency actions:

**I'm Safe**
- Detects the user's geographical location.
- Helps users locate nearby emergency shelters.
- Provides route guidance to the selected shelter.

**I Need Rescue**
- Allows citizens to submit SOS emergency requests.
- Captures the user's GPS location.
- Sends emergency information to the administrator dashboard.
- Allows users to monitor their emergency status.

### 👥 3. Role-Based Dashboards

QuakeCheck supports three user roles:

| Role | Responsibilities |
|---|---|
| Citizen | Report emergencies, mark themselves safe, and navigate to shelters. |
| Administrator | Monitor SOS requests, view rescue-team availability, analyse earthquake information, and assign teams. |
| Rescue Team | View assigned missions, update mission status, and share current location. |

### ⚡ 4. Real-Time Communication
- Socket.IO integration for real-time application updates.
- Notifications when new emergency requests are received.
- Instant rescue assignment notifications.
- Emergency status updates.
- Rescue-team location sharing.

### 🚑 5. Rescue Team Coordination
- Displays emergency requests in the administrator dashboard.
- Shows available rescue teams.
- Provides estimated travel-time information to compare teams.
- Allows administrators to manually assign rescue teams.
- Supports mission status updates such as En Route and Completed.

The final rescue-team assignment remains under administrator control.

### 🗺️ 6. Shelter Navigation and Route Planning
- Uses geographical location to identify nearby shelters.
- Provides route guidance between locations.
- Displays routes on an interactive map.
- Supports route calculation through the dedicated Python routing service.

### 🤖 7. Machine Learning-Based Earthquake Analysis

QuakeCheck includes two additional administrator-only analytical features.

**A. Seismic Impact Severity Analysis – Random Forest**

- Estimates the potential impact severity of an earthquake.
- Uses magnitude, depth, latitude, and longitude as input features.
- Classifies earthquake impact into Low, Moderate, and High categories.
- Displays prediction probabilities to the administrator.
- Uses historical USGS earthquake records with PAGER-based alert categories as training labels.

**B. Historical Earthquake Similarity – K-Nearest Neighbours (KNN)**

- Retrieves five historically similar earthquake records.
- Compares earthquakes using geographical distance, magnitude, and depth.
- Displays historical earthquake details and their PAGER alert categories.
- Helps administrators examine comparable past earthquake events.

**Important:** Both ML features are advisory tools. They do not predict future earthquakes, automatically assign rescue teams, change emergency status, or replace administrator decisions.

---

## 🧰 Technology Stack

| Layer | Technologies |
|---|---|
| Frontend | React 18, Vite, Tailwind CSS |
| UI and Animations | Framer Motion |
| Maps | React Leaflet, Leaflet, CartoDB |
| API Communication | Axios |
| Backend | Node.js, Express.js |
| Database | MongoDB, Mongoose |
| Authentication | JWT, bcryptjs |
| Real-Time Communication | Socket.IO |
| Routing Service | Python, FastAPI, NetworkX |
| ML Service | Python, Flask, scikit-learn |
| ML Algorithms | Random Forest, K-Nearest Neighbours |
| Data Source | USGS earthquake records |
| Development Tools | VS Code, Git, Docker |

---

## 🧠 Machine Learning Implementation

### Dataset

The ML service uses a historical earthquake dataset containing **10,402 records** collected from the United States Geological Survey (USGS).

The dataset includes:
- Earthquake magnitude
- Depth
- Latitude
- Longitude
- Historical PAGER alert category

### Random Forest Model

The Random Forest classifier is trained using four input features:

1. Magnitude
2. Depth
3. Latitude
4. Longitude

The original PAGER alert categories are mapped into three severity classes:

| PAGER Category | Model Class |
|---|---|
| Green | Low |
| Yellow | Moderate |
| Orange and Red | High |

**Recorded model evaluation:**

| Metric | Result |
|---|---:|
| Accuracy | 97.1% |
| Balanced Accuracy | 66.0% |
| Macro F1-score | 65.8% |

The dataset is class-imbalanced, so accuracy should not be interpreted as equal performance across all severity categories.

### KNN Similarity Retrieval

The KNN feature compares an earthquake scenario with the historical dataset using a weighted distance calculation based on:

- Geographical distance
- Magnitude difference
- Depth difference

It retrieves the five records with the smallest calculated distances.

Unlike the Random Forest classifier, this feature performs historical similarity retrieval rather than training a separate severity classification model.

### ML Service Workflow

```text
Historical USGS Dataset
          |
          v
Data Preprocessing
          |
          v
Random Forest Training
          |
          v
Saved Model
          |
          v
Python ML API
          |
          v
Node.js Backend
          |
          v
Administrator Dashboard
```

The KNN feature separately retrieves similar historical records from the same dataset.

---

## 📁 Project Structure

```text
QuakeCheck/
│
├── backend/
│   ├── config/
│   ├── controllers/
│   ├── data/
│   ├── middleware/
│   ├── models/
│   ├── routes/
│   ├── services/
│   ├── tests/
│   ├── utils/
│   ├── server.js
│   ├── package.json
│   └── .env.example
│
├── frontend/
│   ├── public/
│   ├── src/
│   ├── index.html
│   ├── package.json
│   └── .env.example
│
├── ml-service/
│   ├── data/
│   ├── models/
│   ├── reports/
│   ├── tests/
│   ├── app.py
│   ├── common.py
│   ├── predictor.py
│   ├── similarity.py
│   ├── download_data.py
│   ├── train_model.py
│   ├── requirements.txt
│   └── README.md
│
├── routing-service/
│   ├── main.py
│   ├── requirements.txt
│   ├── OSRM_SETUP.md
│   └── .env.example
│
├── .gitignore
└── README.md
```

---

## 🚀 Installation and Setup

### Prerequisites

Install the following before running the project:

- Node.js 18 or later
- npm
- MongoDB (local installation or MongoDB Atlas)
- Python 3.11 or later
- pip
- Git

Additional routing dependencies may be required depending on the configured routing mode.

### 1. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/QuakeCheck.git

cd QuakeCheck
```

### 2. Configure the Backend

```bash
cd backend

npm install
```

Create a `.env` file using `.env.example` and configure the required MongoDB URI, JWT secrets, service URLs, and other environment variables.

Run the backend:

```bash
npm run dev
```

Backend API:

```text
http://localhost:5000
```

Health check:

```text
http://localhost:5000/api/health
```

### 3. Start the Frontend

Open a new terminal:

```bash
cd frontend

npm install

npm run dev
```

Frontend application:

```text
http://localhost:5173
```

Configure the frontend environment variables using the provided `.env.example`.

### 4. Start the Python Routing Service

Open another terminal:

```bash
cd routing-service

python -m venv venv
```

Activate the environment on Windows:

```powershell
.\venv\Scripts\Activate.ps1
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Start the service:

```bash
python -m uvicorn main:app --reload --port 8000
```

Routing API:

```text
http://localhost:8000
```

Health check:

```text
http://localhost:8000/health
```

Refer to `routing-service/OSRM_SETUP.md` for additional routing configuration where required.

### 5. Configure the Machine Learning Service (Optional)

Open another terminal:

```bash
cd ml-service

python -m venv venv
```

Activate the environment on Windows:

```powershell
.\venv\Scripts\Activate.ps1
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Download the historical USGS dataset:

```bash
python download_data.py
```

Train the Random Forest model:

```bash
python train_model.py
```

Start the ML service:

```bash
python app.py
```

ML API:

```text
http://localhost:8001
```

Health check:

```text
http://localhost:8001/health
```

The dataset and trained model must be available before using the ML prediction features. Training is a one-time setup unless the model or dataset is updated.

For detailed dataset, training, evaluation, and Windows instructions, refer to `ml-service/README.md`.

---

## 🔑 Demo Accounts

The application includes seeded demo accounts for testing its different roles, where demo seeding is configured.

| Role | Email |
|---|---|
| Citizen | user@qc.com |
| Administrator | admin@qc.com |
| Rescue Team | rescue@qc.com |

Demo password: `qc123456`

Change or disable demo credentials before using the application outside a local demonstration environment.

---

## 📡 API Reference

The following are the main application endpoints.

### Authentication

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/register` | Register a new user |
| POST | `/api/auth/login` | Authenticate user |
| POST | `/api/auth/refresh` | Refresh access token |
| GET | `/api/auth/me` | Get current user profile |
| POST | `/api/auth/logout` | Log out and invalidate refresh token |

### Emergency Management

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/emergency/safe` | Mark user as safe and request shelter routing |
| POST | `/api/emergency/rescue` | Create an SOS request |
| GET | `/api/emergency/my` | Retrieve user's emergency history |

### Administrator

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/admin/emergencies` | Retrieve all emergencies |
| GET | `/api/admin/stats` | Retrieve dashboard statistics |
| GET | `/api/admin/rescue-teams` | Retrieve rescue teams |
| PATCH | `/api/admin/emergencies/:id/assign` | Assign a rescue team |
| POST | `/api/admin/emergencies/:id/severity` | Run advisory severity analysis |
| POST | `/api/admin/emergencies/:id/similar-earthquakes` | Retrieve five similar historical earthquakes |

The two ML endpoints are read-only analytical operations. They may accept an optional hypothetical scenario containing magnitude, depth, latitude, and longitude.

### Rescue Team

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/rescue/assigned` | Retrieve assigned missions |
| PATCH | `/api/rescue/en-route/:id` | Update mission to en route |
| PATCH | `/api/rescue/complete/:id` | Mark mission as completed |
| PATCH | `/api/rescue/location` | Update rescue-team GPS location |

### Earthquake and Shelter Data

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/feed/earthquakes` | Retrieve earthquake information |
| GET | `/api/feed/stats` | Retrieve earthquake statistics |
| GET | `/api/shelters` | Retrieve shelter information |

### Python Routing Service

| Method | Endpoint | Description |
|---|---|---|
| POST | `/shortest-path` | Calculate a shortest path |
| POST | `/nearest-shelter` | Find a nearby shelter and route |
| POST | `/route-between` | Calculate a route between two locations |
| GET | `/health` | Check service availability |

---

## 🔌 Real-Time Socket.IO Events

QuakeCheck uses Socket.IO for real-time communication between application roles.

| Event | Direction | Description |
|---|---|---|
| `join:user` | Client → Server | Join the user's personal room |
| `join:admin` | Client → Server | Join the administrator room |
| `join:rescue` | Client → Server | Join the rescue-team room |
| `emergency:new` | Server → Admin | Notify administrator of a new SOS |
| `emergency:assigned` | Server → Rescue Team | Notify team about a new assignment |
| `emergency:status` | Server → User | Notify user about emergency status |
| `rescue:location-update` | Server → User | Share rescue-team location updates |

---

## 🔐 Security and Authentication

The application includes:
- JWT-based authentication.
- Access and refresh token handling.
- Password hashing using bcryptjs.
- Role-based access control.
- Protected application routes and administrative operations.
- Separate access to citizen, administrator, and rescue-team features.

Environment variables are used for sensitive configuration. Never commit actual credentials, API keys, or secret values to the repository.

---

## 🎨 User Interface and Design

The application uses a consistent dark-themed visual design.

- **Primary background:** Deep navy (`#0a0f1e`)
- **Accent colour:** Electric blue (`#3b82f6`)
- **Emergency colour:** Red (`#ef4444`)
- **Safety colour:** Green (`#22c55e`)
- **UI framework:** Tailwind CSS
- **Animations:** Framer Motion
- **Typography:** Inter
- **Maps:** React Leaflet with CartoDB Dark Matter tiles

---

## ⚠️ Limitations

QuakeCheck is an academic prototype intended to demonstrate earthquake emergency reporting and rescue coordination.

- The current service area is focused on Chandigarh.
- Operational data, including rescue teams and shelters, may contain demonstration records.
- The platform has not been validated through real-world emergency deployments.
- Routing accuracy depends on the availability and quality of geographical and road-network data.
- ML outputs are estimates based on historical records and are not verified measurements of actual damage or casualties.
- The ML features are advisory and do not automate emergency dispatch.
- The system is not a replacement for official emergency services.

---

## 🔮 Future Enhancements

- Integration with verified emergency-service and shelter information.
- Improved mobile accessibility and responsive design.
- Push notifications for emergency updates.
- Multi-language support.
- Expanded geographical coverage.
- Further evaluation and improvement of ML models.
- Integration with additional disaster-monitoring data sources.

---

## 👨‍💻 Project Information

**Project Name:** QuakeCheck

**Project Category:** Full-Stack Web Application / Disaster Management

**Primary Focus:** Earthquake Emergency Reporting and Rescue Coordination

**Additional Capabilities:** Real-Time Communication, Location-Based Routing, and Machine Learning-Based Earthquake Analysis

---

*QuakeCheck aims to bring emergency reporting, location awareness, and rescue coordination together through a unified digital platform.*
