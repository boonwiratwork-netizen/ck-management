import type { GuideStep } from "@/components/GuideTour";

/** How a branch learns it: on the WIP row the first time it shows (and in the count page's own guide) */
export const WIP_GUIDE: GuideStep[] = [
  {
    target: "count-wip",
    title: "ใหม่: ทำเองที่ร้าน (WIP)",
    body: (
      <>
        ทำชาชูรวมจากเศษชาชูเมื่อไหร่ กด <b>“+ ทำชาชูรวม”</b> แล้วชั่งเศษแต่ละชนิดกรอก ระบบตัดชาชูแต่ละชนิดออก และเพิ่มชาชูรวมให้เอง · เศษที่เอาไปทำแล้ว <b>ไม่ต้องลงของเสีย</b>
      </>
    ),
  },
  {
    title: "ตอนนับสต๊อก",
    body: (
      <>
        ใต้ชื่อชาชูจะมีบรรทัด <b>“ใช้ทำชาชูรวม −…”</b> ระบบหักให้แล้ว · <b>ชาชูรวม</b> ที่เหลือ นับเป็นบรรทัดของตัวเองเหมือนของอื่น · ทำผิด แก้หรือลบได้ที่แถวนี้ จนกว่าจะกด “นับเสร็จ”
      </>
    ),
  },
];
