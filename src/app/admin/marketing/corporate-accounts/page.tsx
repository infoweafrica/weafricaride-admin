"use client";

import { useState } from "react";
import { Building2, Users, DollarSign, Calendar, Search, RefreshCw, Briefcase } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

type CorporateAccount = {
  id: string;
  company_name: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  employees: number;
  monthly_spend: number;
  discount_percent: number;
  status: "active" | "suspended";
  rides_this_month: number;
};

const MOCK_ACCOUNTS: CorporateAccount[] = [
  { id: "1", company_name: "Malawi Telecom Ltd", contact_name: "John Kamwendo", contact_email: "john@malawitelecom.mw", contact_phone: "+265 888 123 456", employees: 45, monthly_spend: 2500000, discount_percent: 15, status: "active", rides_this_month: 320 },
  { id: "2", company_name: "National Bank of Malawi", contact_name: "Grace Banda", contact_email: "grace@nbm.mw", contact_phone: "+265 999 789 012", employees: 120, monthly_spend: 5800000, discount_percent: 20, status: "active", rides_this_month: 680 },
  { id: "3", company_name: "Press Corporation", contact_name: "David Phiri", contact_email: "david@presscorp.mw", contact_phone: "+265 888 345 678", employees: 80, monthly_spend: 3200000, discount_percent: 15, status: "active", rides_this_month: 410 },
  { id: "4", company_name: "Lilongwe Water Board", contact_name: "Mary Mwale", contact_email: "mary@lwb.mw", contact_phone: "+265 999 901 234", employees: 25, monthly_spend: 980000, discount_percent: 10, status: "active", rides_this_month: 145 },
  { id: "5", company_name: "University of Malawi", contact_name: "Prof. Chibwana", contact_email: "admin@unima.mw", contact_phone: "+265 888 567 890", employees: 200, monthly_spend: 4500000, discount_percent: 25, status: "active", rides_this_month: 560 },
];

export default function CorporateAccountsPage() {
  const [search, setSearch] = useState("");
  const [accounts] = useState(MOCK_ACCOUNTS);

  const filtered = accounts.filter((a) =>
    a.company_name.toLowerCase().includes(search.toLowerCase()) ||
    a.contact_name.toLowerCase().includes(search.toLowerCase())
  );

  const totalMonthly = accounts.reduce((s, a) => s + a.monthly_spend, 0);
  const totalEmployees = accounts.reduce((s, a) => s + a.employees, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Corporate Accounts</h1>
          <p className="text-gray-500 mt-1">Manage corporate clients, monthly billing, staff rides, and discounts</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <Building2 className="h-5 w-5 text-blue-600 mb-2" />
          <p className="text-xs text-gray-500">Active Accounts</p>
          <p className="text-2xl font-bold">{accounts.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <Users className="h-5 w-5 text-green-600 mb-2" />
          <p className="text-xs text-gray-500">Total Employees</p>
          <p className="text-2xl font-bold">{totalEmployees.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <DollarSign className="h-5 w-5 text-amber-600 mb-2" />
          <p className="text-xs text-gray-500">Monthly Revenue</p>
          <p className="text-2xl font-bold">{formatCurrency(totalMonthly)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <Briefcase className="h-5 w-5 text-purple-600 mb-2" />
          <p className="text-xs text-gray-500">Rides This Month</p>
          <p className="text-2xl font-bold">{accounts.reduce((s, a) => s + a.rides_this_month, 0).toLocaleString()}</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input type="text" placeholder="Search corporate accounts..." value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-green-500" />
      </div>

      {/* Accounts */}
      <div className="space-y-4">
        {filtered.map((account) => (
          <div key={account.id} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-50 rounded-lg">
                  <Building2 className="h-6 w-6 text-blue-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">{account.company_name}</h3>
                  <p className="text-xs text-gray-500">{account.contact_name} • {account.contact_email}</p>
                </div>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${account.status === "active" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                {account.status}
              </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
              <div>
                <p className="text-xs text-gray-400">Employees</p>
                <p className="font-medium">{account.employees}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Monthly Spend</p>
                <p className="font-medium">{formatCurrency(account.monthly_spend)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Discount</p>
                <p className="font-medium text-green-600">{account.discount_percent}%</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Rides This Month</p>
                <p className="font-medium">{account.rides_this_month}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Phone</p>
                <p className="font-medium text-xs">{account.contact_phone}</p>
              </div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="text-center text-gray-400 text-sm py-12">No corporate accounts found</div>
        )}
      </div>
    </div>
  );
}