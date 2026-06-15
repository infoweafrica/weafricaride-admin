import React from "react";

type Props = {
  children: React.ReactNode;
  className?: string;
};

export default function PageCard({
  children,
  className = "",
}: Props) {
  return (
    <div
      className={`
        bg-white
        rounded-2xl
        border
        border-gray-200
        shadow-sm
        p-6
        ${className}
      `}
    >
      {children}
    </div>
  );
}
