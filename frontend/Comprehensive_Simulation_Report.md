# Comprehensive Technical Report: Adaptive Traffic Signal Simulation

## 1. Introduction

Traffic congestion remains a primary challenge in modern urban infrastructure. This simulator provides an advanced environment to evaluate, visualize, and compare different traffic signal control policies in a configurable city road network. 

Users can model custom road networks by adjusting granular hyperparameters such as:
*   **Grid Dimensions**: Define the number of intersections (N x N).
*   **Vehicular Arrival & Departure Rates**: Set deterministic or stochastic inflows.
*   **Vehicle Arrival Distributions**: Emulate real-world traffic flows using continuous or discrete probabilistic functions.
*   **Vehicle Turn Probabilities**: Control the probability of vehicles going straight, turning right, or making a free left turn.

The core goal of this simulator is to compare the globally deployed standard **Fixed-Cycle Policy** against a custom, mathematically rigorous **H-step Lookahead Policy** (also referred to as the Greedy algorithm). While theoretical evidence suggests that the adaptive H-step lookahead policy minimizes congestion and wait times universally, this simulator offers the **empirical evidence** required to substantiate this claim. It provides a sandbox for users to generate varying traffic conditions (from light traffic to gridlock) and tangibly observe the performance superiority of our adaptive approach.

// [Screenshot: Main UI of the simulator showing the grid and side panels]

---

## 2. Core Policies

The simulator models vehicles as discrete objects, ensuring high fidelity. The two policies run simultaneously in lockstep, experiencing the exact same arrival rates and pseudo-random intents, ensuring a completely fair and deterministic comparison.

### 2.1 The Fixed-Cycle Policy
The fixed-cycle policy is the standard approach used in most real-world traffic intersections today. It operates blindly, without considering the current queue length or waiting times of vehicles.

*   **Mechanism**: The policy cycles through a predetermined set of traffic light phases. In this simulator, it cycles through four standard phases (matching Indian traffic conventions):
    1.  `NT_ST` (Northbound & Southbound Through)
    2.  `ET_WT` (Eastbound & Westbound Through)
    3.  `NR_SR` (Northbound & Southbound Right Turn)
    4.  `ER_WR` (Eastbound & Westbound Right Turn)
*   *Note on Left Turns*: According to the Indian convention used in the simulator, left turns (`L`) are considered "free" and bypass the signal entirely.
*   **Phase-Change Interval**: A hyperparameter that dictates how many timesteps a single phase lasts before transitioning to the next.

This policy serves as the baseline. It performs adequately under uniform, continuous traffic but fails spectacularly when faced with bursty traffic or uneven congestion, as it continues serving empty lanes while heavily congested lanes wait.

// [Screenshot: An intersection in the Fixed-Cycle grid showing vehicles waiting while an empty lane gets the green light]

### 2.2 The Custom H-Step Lookahead Policy (Greedy Algorithm)
The H-step lookahead policy is a sophisticated, adaptive algorithm that looks into the future to make the optimal phase decision at the current timestep.

#### How it Works:
At every decision interval, for *each* intersection, the algorithm performs the following operations:
1.  **State Cloning**: It creates a deep copy of the current intersection's queues, and the transit queues of vehicles heading toward this intersection.
2.  **Horizon Simulation**: It simulates the traffic flow `H` steps into the future (where `H` is the lookahead horizon hyperparameter). It accounts for vehicles arriving from transit, expected boundary arrivals, and vehicles exiting the intersection.
3.  **Phase Evaluation**: It evaluates all 8 possible phases (including combined through+right phases like `NT_NR` and opposing phases like `NT_ST`). For each phase, it simulates applying that phase for the next `H` steps.
4.  **Cost Function Calculation**: After `H` steps, it calculates a "penalty score" for that specific phase using a weighted objective function:
    `Score = (w1 * Sum(Total Wait Time)) + (w2 * StdDev(Total Wait Time)) + (w3 * Sum(Queue Lengths)) + (w4 * StdDev(Queue Lengths))`
5.  **Selection**: The algorithm selects the phase that yields the minimum score (lowest cost/penalty) and applies it for the upcoming decision interval.

#### Complexity:
The time complexity of this algorithm is `O(I * 8 * H * S)`, where:
*   `I` = Number of intersections.
*   `8` = Number of candidate phases evaluated.
*   `H` = Lookahead horizon (timesteps).
*   `S` = Complexity of simulating a single step (proportional to vehicle count).
Since the decision is calculated locally per intersection, it scales linearly with the grid size, making it highly efficient for real-time application.

// [Screenshot: Stats dashboard showing the Phase Timeline, contrasting the rigid Fixed-Cycle stairs with the dynamic Greedy phase switching]

---

## 3. Configuration & Hyperparameters

The simulator allows deep customization through the configuration panel. Here is a comprehensive breakdown of every parameter the user can adjust.

### 3.1 Global Simulator Settings
*   **Grid Size (N x N)**: Defines the dimensions of the city. A 3x3 grid yields 9 intersections.
*   **Simulation Duration**: Total number of timesteps the simulation will run.
*   **Fixed-Cycle Phase-Change Interval**: The duration (in timesteps) each phase lasts in the fixed-cycle policy.
*   **Greedy Policy Decision Interval**: How often the H-step algorithm re-evaluates and potentially changes the phase.
*   **Lookahead H**: The number of timesteps the Greedy algorithm projects into the future. Must be ≤ the Decision Interval.
*   **Random Seed**: Ensures the random number generators (RNG) produce identical vehicle arrivals and intents across both policies for reproducible comparisons.

### 3.2 Greedy Objective Weights
These weights tune the cost function of the H-step lookahead algorithm.
*   **Total Wait Weight (w1)**: Penalizes the sum of all time spent by vehicles waiting in queues. High values prioritize clearing long-waiting cars.
*   **Total Wait Std Dev Weight (w2)**: Penalizes variance in wait times across different approaches. High values ensure fairness (preventing starvation of a specific lane).
*   **Queue Length Weight (w3)**: Penalizes the absolute number of vehicles waiting. High values prioritize sheer throughput.
*   **Queue Std Dev Weight (w4)**: Penalizes variance in queue sizes, attempting to balance the number of cars waiting across North, South, East, and West queues.

### 3.3 Default Road Properties
*   **Default Speed & Length**: Used to compute the Travel Time (`Length / Speed`). This determines how long a vehicle stays in the "transit queue" between intersections.
*   **Default Turn Probabilities (Through, Right, Left)**: Defines the probability distribution of a vehicle's intended direction. They must sum to 1.0.
*   **Default Departure Rate**: The maximum number of vehicles that can exit an intersection per timestep per lane during a green light.

### 3.4 Boundary Inflow & Overrides
Boundary intersections act as the source of new vehicles. 
*   **Global Inflow Cap**: A hard limit on the maximum vehicles spawned per step.
*   **Modes**:
    *   **Constant**: A static arrival rate (e.g., exactly 2 cars per step).
    *   **Function**: Mathematical profiles to simulate wave-like traffic (Step, Piecewise Linear, Triangular, Square, Sawtooth, Pulse Train, SinCos).
    *   **Distribution**: Probabilistic statistical distributions mapping to real-world traffic models (e.g., Poisson for random arrivals, Lognormal).
*   **Per Road / Per Intersection Overrides**: Users can override the default speed, length, turn probabilities, and inflow functions for *specific* roads or intersections to simulate local events like a highway exit, a bottleneck, or a stadium emptying out.

// [Screenshot: The Configuration Panel, specifically showing the mathematical Function inflow charts and the weights input boxes]

---

## 4. Metrics & Graphical Dashboards

To prove the superiority of the H-Step Lookahead algorithm, the simulator tracks and graphs an extensive array of metrics at both the global and local intersection levels.

### 4.1 Global Metrics
*   **Throughput (Exited) & Throughput Gap**: The total number of vehicles that have successfully navigated and exited the network. The gap explicitly shows how many *more* vehicles the Greedy algorithm processed compared to Fixed.
*   **In Network Now**: Current number of vehicles traversing the grid.
*   **Cumulative Throughput (Line Chart)**: Tracks total exited vehicles over time. The Greedy line consistently diverges upwards from the Fixed line.
*   **Sum of Queue Sizes (Line Chart)**: The aggregate sum of all waiting vehicles across the entire city over time. Lower is better.
*   **Sum of Average & Total Waiting Time (Line Chart)**: Total accrued wait time of all queued vehicles. A critical metric demonstrating how much time the Greedy algorithm saves commuters.
*   **Boundary Inflow Function (Planned vs Realized)**: Verifies that the theoretical inflow mathematical function (e.g., SinCos) matches the actual vehicles injected into the simulation.

// [Screenshot: The 'Throughput Difference Over Time' graph showing the Greedy algorithm outperforming the Fixed cycle]

### 4.2 Per-Intersection Metrics
*   **Per-Intersection Win/Loss Heatmap**: A color-coded grid mapping the city. It calculates which policy is currently winning based on a selectable metric (Queue Size, Avg Wait, Total Wait, or Vehicles Exited). Green indicates Greedy is winning, Red indicates Fixed is winning. This visually proves that Greedy's superiority is systemic, not isolated.
*   **Live Queue Bar Chart**: A side-by-side bar graph comparing the live queue lengths at every intersection.
*   **Intersection Specific Charts**: By clicking on a specific coordinate (e.g., `(1,1)`), the user can view:
    *   **Queue Lengths per Approach**: Separate lines for North, South, East, West queues.
    *   **Average & Total Waiting Time per Approach**.
    *   **Phase Timeline**: A categorical step-chart illustrating the exact traffic light phases selected over time. It visually contrasts the rigid stair-step pattern of the Fixed cycle with the adaptive, reactive phase-switching of the Greedy algorithm.

// [Screenshot: The Per-Intersection Win/Loss Heatmap predominantly colored green]
// [Screenshot: Phase timeline chart comparing Fixed vs Greedy]

---

## 5. Real-World City Map Import Feature

To ground the theoretical models in reality, the simulator includes a powerful "City Import" feature that fetches real-world road networks and maps them to the simulator grid.

### 5.1 OSM API Extraction
Using the **Nominatim** API for geocoding and the **Overpass API** for fetching OpenStreetMap (OSM) data, the simulator dynamically retrieves the actual geographical nodes (points) and ways (roads) of any queried city or address.

### 5.2 Node Clustering and Selection
Real-world maps are highly complex. A single intersection might be represented by multiple nodes in OSM data.
1.  **Clustering (`collapseIntersectionClusters`)**: The parser calculates the Haversine distance between nodes. Nodes within a specific radius (e.g., 90 meters) are logically merged into a single intersection to accurately represent a real-world junction.
2.  **Selection (`selectIntersectionsForSimulation`)**: The algorithm scores intersections based on connectivity (number of connected major roads) and presence of traffic signals. It extracts the top most-connected nodes to form the backbone of the simulation.

### 5.3 Grid Mapping (`assignNodesToGridWithGraph`)
Because the simulator runs on a discrete `N x N` grid rather than floating-point geographical coordinates, the parser performs a topology-preserving transformation:
1.  It builds an adjacency graph of the selected intersections based on the real-world road links.
2.  It translates the bounding box of coordinates into floating-point grid locations.
3.  Using a Breadth-First Search (BFS) seeded approach, it snaps the geographical coordinates to the nearest available discrete integer cell `(r, c)`. It strictly preserves the adjacency constraints, meaning if Intersection A is north of Intersection B in real life, it forces them to be connected in the discrete grid.

**Future Utility**: Currently, this feature extracts the nodes and visualizes the network. In upcoming iterations, the resulting parsed graph will directly populate the simulation `grid` object, allowing the H-step lookahead algorithm to optimize actual traffic configurations of cities like New York or New Delhi.

// [Screenshot: The Real-World City Import Panel showing a parsed map of a real address]

---

## 6. Conclusion

By providing deep hyperparameter customization alongside a lockstep, deterministic simulation engine, this software delivers undeniable empirical evidence that an H-step Lookahead (Greedy) policy drastically outperforms standard Fixed-Cycle policies. Through the granular metrics, heatmaps, and customizable inflow distributions, users can easily observe how adaptive algorithms minimize wait times, reduce queue lengths, and maximize global throughput irrespective of varying traffic conditions.
