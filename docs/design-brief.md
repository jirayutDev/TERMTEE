# Design Brief: TERMTEE

## 1. ภาพรวม

TERMTEE คือเว็บขายตั๋วดู **live สด** แบบจ่ายรายครั้ง (pay-per-view) ดู **ย้อนหลัง** ได้ตามจำนวนวันที่กำหนดในแต่ละ event
content มี license ถูกต้อง และกันการอัด/แชร์หน้าจอด้วย hardware DRM

- ภาษา UI: **ไทย** (ศัพท์เทคนิคบางคำใช้อังกฤษได้ เช่น LIVE, Replay)
- อุปกรณ์: **mobile-first** แล้วขยายไป tablet และ desktop. คนดูส่วนใหญ่ใช้มือถือ
- Tech: Next.js 16 + Tailwind CSS v4. ส่งงานเป็น design tokens + component ที่ทำเป็น Tailwind ได้

## 2. อารมณ์ / แบรนด์

- **Dark theme เป็นหลัก** (เว็บดูวิดีโอ) พื้นหลังเข้ม ให้วิดีโอและ cover เด่น
- อารมณ์: พรีเมียม น่าเชื่อถือ ตื่นเต้นแบบ live event. ไม่ใช่เว็บเถื่อน ต้องดูถูกลิขสิทธิ์
- สี accent 1 สีสำหรับปุ่มหลัก (ซื้อตั๋ว / ดูเลย). **สีแดง** ใช้เฉพาะ badge LIVE
- ฟอนต์ไทยอ่านง่าย เช่น IBM Plex Sans Thai / Noto Sans Thai. ตัวเลขราคาและเวลาต้องชัด
- ยังไม่มีโลโก้. ทำ wordmark "TERMTEE" ชั่วคราวให้ด้วย

## 3. ผู้ใช้

| กลุ่ม | ต้องการ |
|---|---|
| คนดู | หา event → ซื้อตั๋ว (โอนผ่าน PromptPay + อัปโหลดสลิป) → ดูสดหรือย้อนหลัง |
| Admin | สร้าง event, เริ่ม/หยุด live, ดูยอดขาย, ยกเลิกตั๋ว |

## 4. หน้าที่ต้องออกแบบ

### ฝั่งคนดู

**4.1 หน้าแรก (`/`)**
- Header: wordmark, เมนู (หน้าแรก, ตั๋วของฉัน), ปุ่ม Login with Google / avatar
- ส่วน "กำลัง LIVE" อยู่บนสุด (badge LIVE สีแดงกะพริบเบาๆ)
- "เร็วๆ นี้" (SCHEDULED): การ์ด cover, ชื่อ, วันเวลาแบบไทย, ราคา
- "ดูย้อนหลัง" (ENDED): การ์ด + "ดูย้อนหลังได้ถึง [วันที่]"
- Empty state: ยังไม่มี event

**4.2 รายละเอียด event (`/events/[slug]`)**
- Cover ใหญ่, ชื่อ, คำอธิบาย, วันเวลาเริ่ม, ราคา, สถานะ, "ดูย้อนหลังได้ X วันหลังจบ live"
- **กล่องเช็ก device** (สำคัญ): แสดงก่อนปุ่มซื้อ
  - ✅ "เครื่องนี้รองรับ" หรือ
  - ⛔ "เครื่องนี้ดูไม่ได้" + ลิงก์ไปดูว่าเครื่องไหนดูได้
  - ต้องเห็นชัดก่อนจ่ายเงิน กันคนซื้อแล้วดูไม่ได้
- ปุ่มซื้อตั๋ว (แสดงราคา) / ถ้ามีตั๋วแล้ว → ปุ่ม "ดูเลย"
- States: ยังไม่เปิดขาย, กำลังขาย, LIVE อยู่, จบแล้ว (ขาย replay ต่อได้ไหมขึ้นกับ event), หมดอายุ

**4.3 ชำระเงิน (`/pay/[orderId]`)**
- ยอดเงินตัวใหญ่ + PromptPay QR (ยอดตรง) + ชื่อบัญชี/ธนาคาร
- อัปโหลดสลิป (เลือกรูป / ถ่ายรูป) + preview + ปุ่ม "ตรวจสอบสลิป" (OCR ใช้ 5–15 วิ)
- VERIFIED: ✅ + ปุ่ม "ไปดู"
- NEEDS_REVIEW: "กำลังรอเจ้าหน้าที่ตรวจสอบ" (อัปเดตอัตโนมัติ)
- REJECTED: เหตุผล + อัปโหลดใหม่
- PAID แล้ว: ลิงก์ไปดู

**4.4 หน้าดู (`/watch/[slug]`): สำคัญที่สุด**
- Player เต็มความกว้าง (mobile แนวตั้ง + แนวนอน + fullscreen)
- Controls แบบ custom มินิมอล: play/pause, เสียง, fullscreen. **ไม่มี** ปุ่มดาวน์โหลด, ไม่มี picture-in-picture, ไม่มีเลือกความละเอียด
- Live: badge LIVE + จำนวนเวลาที่ live ไปแล้ว, ไม่มี seek bar
- Replay: มี seek bar + "ดูได้ถึง [วันที่]"
- **Watermark**: email + รหัสสั้นของคนดู + เวลา, โปร่งแสง, ย้ายตำแหน่งทุก 5–10 วิ. ต้องอ่านออกแต่ไม่บังภาพ. ออกแบบ style ให้ด้วย
- States ที่ต้องมี:
  - กำลังโหลด / กำลังเช็กเครื่อง
  - เครื่องไม่รองรับ → พาไปหน้า 4.5
  - **ถูกเปิดดูจากเครื่องอื่น** (1 ตั๋วดูได้ 1 เครื่อง) + ปุ่ม "ดูที่เครื่องนี้แทน"
  - Live ยังไม่เริ่ม (นับถอยหลัง)
  - Live จบ กำลังเตรียม replay
  - Replay หมดอายุ / ไม่มีตั๋ว / ตั๋วถูกยกเลิก
  - เน็ตหลุด / กำลัง reconnect

**4.5 เครื่องไม่รองรับ (`/unsupported`)**
- อธิบายแบบไม่ใช้ศัพท์เทคนิค: "เพื่อป้องกันการอัดหน้าจอ ต้องดูผ่านเครื่อง/browser ที่รองรับ"
- รายการที่ดูได้ (ทำเป็นการ์ด/ไอคอน): Safari บน Mac / iPhone / iPad, Microsoft Edge บน Windows, Chrome บน Android, Chrome บน Windows บางรุ่น
- "แอป Desktop เร็วๆ นี้"
- ปุ่มคัดลอกลิงก์ เพื่อเปิดในเครื่องอื่น

**4.6 ตั๋วของฉัน (`/library`)**
- รายการตั๋ว: cover, ชื่อ, สถานะ (รอ live / LIVE / ดูย้อนหลังได้ถึง… / หมดอายุ / ถูกยกเลิก), ปุ่มดู
- Empty state

**4.7 Login**
- Login with Google อย่างเดียว

### ฝั่ง Admin (desktop เป็นหลัก, เน้นใช้งานง่าย ไม่ต้องหรู)

**4.8 รายการ event**: ตาราง ชื่อ, วันเวลา, สถานะ, จำนวนตั๋ว, รายได้, ปุ่มแก้ไข

**4.9 สร้าง/แก้ไข event**: ชื่อ, slug, คำอธิบาย, cover URL, ราคา (บาท), วันเวลาเริ่ม, จำนวนวันดูย้อนหลัง, ประเภท input (SRT / RTMP / HLS), HLS URL (เมื่อเลือก HLS), สถานะ (Draft / เปิดขาย)

**4.10 ควบคุม event**
- ข้อมูล ingest: SRT URL, RTMP URL, stream key (ซ่อน/แสดง + ปุ่มคัดลอก)
- ปุ่ม **Start live / Stop live** (Stop ต้อง confirm), ปุ่มลบ replay (confirm)
- สถานะ live real-time
- รายการคนซื้อ + ปุ่มยกเลิกตั๋ว (confirm)

## 5. Components ที่ต้องการ

Header, Event card (3 สถานะ), Badge (LIVE / เร็วๆ นี้ / Replay / หมดอายุ), Price, Button (primary / secondary / danger), Device check box, Player controls, Watermark, Player state overlay, Empty state, Table (admin), Form fields, Confirm dialog, Toast

## 6. Design tokens ที่ต้องส่งมอบ

สี (background, surface, text, muted, accent, live-red, success, warning, danger), typography scale (ไทย), spacing, radius, shadow. ทำเป็น CSS variables ใช้กับ Tailwind v4 ได้

## 7. ข้อกำหนด

- Contrast ผ่าน WCAG AA, ปุ่มบนมือถือสูงอย่างน้อย 44px
- วันเวลาแบบไทย เช่น "ส. 12 ต.ค. 2569 · 20:00 น."
- ราคาแบบ "฿199"
- Loading / empty / error state ครบทุกหน้า

## 8. ไม่อยู่ใน scope

แชทระหว่าง live, ระบบสมาชิกรายเดือน, แอปมือถือ native
