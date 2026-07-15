## สาเหตุของบั๊ก

ใน `src/hooks/use-sm-stock-data.ts` มีสูตรคำนวณ "จำนวนที่ส่งออก" ผิดอยู่ 2 จุด (บรรทัด 136 และ 350):

```ts
const qty = line.actual_qty > 0
  ? line.actual_qty
  : toStatusMap[line.to_id] === "Sent" ? line.planned_qty : 0;
```

ตรรกะนี้อ่านว่า: "ถ้า actual_qty > 0 ใช้ actual_qty, ไม่งั้นถ้า TO ถูก Sent แล้วให้ fallback ไปใช้ **planned_qty**"

ผลคือเมื่อครัวกลางกรอก `actual_qty = 0` (ส่งไป 0) แล้วกด "ส่งใบโอน" ระบบจะเห็นว่า 0 ไม่มากกว่า 0 → เข้าเงื่อนไข fallback → หัก stock ตาม **จำนวนที่สาขาขอมา (planned_qty)** แทน

ที่ TO_line ฝั่ง RM/PK ไม่มีปัญหานี้ เพราะการหักสต๊อกใช้ `stock_adjustments` ที่ insert เฉพาะเมื่อ `actual_qty > 0` (ดู `sendTO` ใน `use-transfer-order.ts`) — บั๊กนี้จึงเกิดเฉพาะกับ **SM stock** ที่คำนวณสดจาก `transfer_order_lines`

## สิ่งที่จะแก้

เปลี่ยนสูตรทั้ง 2 จุดใน `src/hooks/use-sm-stock-data.ts` ให้ใช้ `actual_qty` เป็นค่าจริงเสมอเมื่อ TO ถูก Sent/Received แล้ว (เพราะตอน sendTO ระบบเขียน `actual_qty` ลง DB เรียบร้อยแล้ว) และ fallback ไป `planned_qty` เฉพาะกรณีค่า `actual_qty` เป็น null/undefined เท่านั้น:

```ts
const qty = line.actual_qty != null ? line.actual_qty : (line.planned_qty ?? 0);
```

จุดที่แก้:
- `use-sm-stock-data.ts` บรรทัด 136 (initial load)
- `use-sm-stock-data.ts` บรรทัด 350 (`refreshToDelivered`)

ไม่แตะ UI, ไม่แตะ RM/PK logic, ไม่แตะ `sendTO`

## หลังแก้แล้ว

- ถ้า CK ส่ง 0 → SM stock จะไม่ถูกหัก
- ถ้า CK ส่งน้อยกว่าที่ขอ → หักเฉพาะจำนวนที่ส่งจริง
- StockCard ledger จะสอดคล้องกับ SM Stock table
