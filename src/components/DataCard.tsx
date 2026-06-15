import React from "react";

type Props = {
  title: string;
  value: React.ReactNode;
  subtitle?: string;
  icon?: React.ReactNode;
};

export default function DataCard({
  title,
  value,
  subtitle,
  icon,
}: Props) {
  return (
    <div className="
      bg-white
      rounded-2xl
      border
      border-gray-200
      shadow-sm
      p-6
    ">
      <div className="flex items-center justify-between">

        <div>
          <p className="text-xs text-gray-500">
            {title}
          </p>

          <h2 className="text-3xl font-bold text-gray-900 mt-2">
            {value}
          </h2>

          {subtitle && (
            <p className="text-sm text-gray-500 mt-1">
              {subtitle}
            </p>
          )}
        </div>

        {icon && (
          <div className="
            h-12
            w-12
            rounded-2xl
            bg-green-50
            flex
            items-center
            justify-center
          ">
            {icon}
          </div>
        )}

      </div>
    </div>
  );
}
