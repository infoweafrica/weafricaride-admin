path = "src/lib/admin-auth.ts"
with open(path, "r") as f:
    lines = f.readlines()

start_idx = None
end_idx = None
for i, line in enumerate(lines):
    if "// 4. Update last login" in line:
        start_idx = i
    if start_idx is not None and '.eq("id", admin.id);' in line:
        end_idx = i
        break

if start_idx is None or end_idx is None:
    print("ERROR: anchors not found. start=%s end=%s" % (start_idx, end_idx))
    raise SystemExit(1)

del lines[start_idx:end_idx + 1]

with open(path, "w") as f:
    f.writelines(lines)

print("Removed redundant update block, lines %d-%d" % (start_idx + 1, end_idx + 1))
