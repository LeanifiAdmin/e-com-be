export type AdminRole = "admin" | "pharmacist";

export type DriverStatus = "Available" | "Busy";
export type Driver = {
  id: string;
  name: string;
  status: DriverStatus;
};

export type Medicine = {
  id: string;
  name: string;
  description: string;
  price: number;
  stockQty: number;
};

export type OrderStatus = "Pending" | "Approved" | "Rejected";
export type DriverAssignment = {
  driverId: string;
  driverName: string;
  assignedAt: string;
};

export type Order = {
  id: string;
  customerName: string;
  status: OrderStatus;
  date: string;
  prescriptionImageUrl: string;
  assignedDriver?: DriverAssignment;
  deliveryJobStatus?: "Unassigned" | "Assigned" | "Accepted";
  deliveryAcceptedAt?: string;
};

export type User = {
  id: string;
  name: string;
  phone: string;
  email?: string;
};

export type UserOrderHistory = {
  userId: string;
  orders: Array<{
    id: string;
    status: OrderStatus;
    date: string;
  }>;
};

// In-memory "DB" for frontend integration.
// Replace with real DB later.
export const orders: Order[] = [
  {
    id: "LF-1032",
    customerName: "Aarav Sharma",
    status: "Pending",
    date: "2026-03-25",
    prescriptionImageUrl: "/images/prescription-placeholder.svg",
  },
  {
    id: "LF-1037",
    customerName: "Meera Iyer",
    status: "Approved",
    date: "2026-03-24",
    prescriptionImageUrl: "/images/prescription-placeholder.svg",
    assignedDriver: {
      driverId: "d1",
      driverName: "John",
      assignedAt: "2026-03-24T10:20:00Z",
    },
  },
  {
    id: "LF-1041",
    customerName: "Vihaan Verma",
    status: "Rejected",
    date: "2026-03-23",
    prescriptionImageUrl: "/images/prescription-placeholder.svg",
  },
  {
    id: "LF-1049",
    customerName: "Sanya Gupta",
    status: "Pending",
    date: "2026-03-26",
    prescriptionImageUrl: "/images/prescription-placeholder.svg",
  },
];

export const medicines: Medicine[] = [
  {
    id: "m1",
    name: "Amoxicillin 500mg",
    description: "Antibiotic used to treat a variety of bacterial infections.",
    price: 149.0,
    stockQty: 42,
  },
  {
    id: "m2",
    name: "Paracetamol 650mg",
    description: "Pain reliever and fever reducer.",
    price: 39.5,
    stockQty: 120,
  },
  {
    id: "m3",
    name: "Cetirizine 10mg",
    description: "Antihistamine for allergy symptoms.",
    price: 52.0,
    stockQty: 18,
  },
];

export const users: User[] = [
  { id: "u1", name: "Rohan Mehta", phone: "+91 9876541001", email: "rohan@domain.com" },
  { id: "u2", name: "Ananya Banerjee", phone: "+91 9876541002", email: "ananya@domain.com" },
  { id: "u3", name: "Ishaan Khanna", phone: "+91 9876541003", email: "ishaan@domain.com" },
];

export const userOrderHistory: UserOrderHistory[] = [
  {
    userId: "u1",
    orders: [
      { id: "LF-1032", status: "Pending", date: "2026-03-25" },
      { id: "LF-1021", status: "Approved", date: "2026-03-14" },
    ],
  },
  {
    userId: "u2",
    orders: [{ id: "LF-1037", status: "Approved", date: "2026-03-24" }],
  },
  {
    userId: "u3",
    orders: [{ id: "LF-1041", status: "Rejected", date: "2026-03-23" }],
  },
];

export const drivers: Driver[] = [
  { id: "d1", name: "John", status: "Available" },
  { id: "d2", name: "Priya", status: "Busy" },
  { id: "d3", name: "Rahul", status: "Available" },
];

