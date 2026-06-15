import React from "react";

type Props = {
  children: React.ReactNode;
};

export default function FilterBar({
  children,
}: Props) {
  return (
    <div className="
      bg-white
      rounded-2xl
      border
      border-gray-200
      shadow-sm
      p-4
      flex
      flex-wrap
      gap-3
      items-center
    ">
      {children}
    </div>
  );
}
