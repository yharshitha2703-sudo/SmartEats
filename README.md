# 🍽 SmartEats – Online Food Delivery System  
Real-time food delivery tracking system built using *Node.js, Express, MongoDB, Redis, RabbitMQ, Socket.io, and **Prometheus monitoring*.  
Includes *customer app, delivery partner app, admin panel, and **live order tracking simulation*.

---

## 🚀 Features

### 🧑‍🍳 Customer Application
- View restaurants and menu items  
- Add items to cart  
- Place orders with typed address  
- Track delivery partner live on map  
- See ETA updates (auto-decreasing)  
- Real-time order status updates  
- Secure login & signup (JWT-based)

### 🚚 Delivery Partner Application
- View assigned orders  
- See customer location  
- Live delivery movement simulation (auto movement)  
- Status timeline updates  
- Map-based navigation UI

### 🛠 Admin Panel
- Manage restaurants  
- Manage menu items  
- View all orders  
- Monitor system activity  

---

## ⚙ Technologies Used

### *Frontend*
- HTML5  
- CSS3  
- JavaScript (Vanilla JS)  
- Leaflet.js / Google Maps (for tracking)

### *Backend*
- Node.js  
- Express.js  
- MongoDB + Mongoose  
- Redis (Caching & Sessions)  
- RabbitMQ (Order Queue)  
- Socket.io (Real-Time Tracking)  
- Prometheus (Metrics & Monitoring)

---

## 🔁 Real-Time Delivery Tracking (Simulation)

SmartEats includes a *delivery movement simulation*, perfect for college projects where GPS cannot be used.

### How it works:
- Customer enters typed address  
- System converts address → coordinates (Geocoding API)  
- Backend generates auto movement path  
- Socket.io sends simulated driver coordinates every 2 seconds  
- Customer & delivery partner dashboards update live  
- ETA dynamically decreases  
- Automatic order statuses:
  - Order Confirmed  
  - Food Prepared  
  - Picked Up  
  - On the Way  
  - Arriving Soon  
  - Delivered  

---

## 📂 Project Folder Structure
