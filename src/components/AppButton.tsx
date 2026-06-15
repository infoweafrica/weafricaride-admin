import React from "react";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "warning";
};

export default function AppButton({ variant = "primary", className = "", children, ...props }: Props) {
  const styles = {
    primary: "bg-green-600 text-white hover:bg-green-700 shadow-sm shadow-green-200",
    secondary: "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50",
    danger: "bg-red-600 text-white hover:bg-red-700",
    warning: "bg-orange-600 text-white hover:bg-orange-700",
  };

  return (
    <button
      className={`h-11 px-4 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 ${styles[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
