const express = require('express');
const cors = require('cors');
const fs = require('fs');
const app = express();

app.use(cors());
app.use(express.json());

const DB_FILE = './licenses.json';

function getLicenses() {
  if (!fs.existsSync(DB_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { return {}; }
}

function saveLicenses(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// 1. Desktop App gọi vào để kiểm tra hạn dùng
app.get('/api/check-license', (req, res) => {
  const deviceId = req.query.device_id;
  if (!deviceId) return res.json({ active: false });

  const licenses = getLicenses();
  const lic = licenses[deviceId];

  if (!lic) return res.json({ active: false });

  const now = new Date();
  const expireDate = new Date(lic.expire_date);

  if (now <= expireDate) {
    return res.json({
      active: true,
      expire_date: expireDate.toLocaleDateString('vi-VN')
    });
  }

  return res.json({ active: false, expired: true });
});

// 2. Webhook SePay gọi vào khi có giao dịch chuyển khoản ACB thành công
app.post('/api/sepay-webhook', (req, res) => {
  const { content, transferAmount } = req.body;
  if (!content) return res.status(400).send("No content");

  console.log(`[SePay] Nhận giao dịch: ${transferAmount} đ - Nội dung: "${content}"`);

  const licenses = getLicenses();

  // Tìm chuỗi mã máy dạng CAFE + 8 ký tự (VD: CAFE6FA23BE1)
  const match = content.toUpperCase().match(/CAFE[A-Z0-9]{8}/);
  if (!match) {
    console.log("-> Bỏ qua: Không tìm thấy mã máy CAFE trong nội dung");
    return res.json({ success: false, msg: "Không tìm thấy mã máy" });
  }

  const rawKey = match[0];
  // Tái tạo lại định dạng chuẩn: CAFE-XXXX-XXXX
  const fullDeviceId = `${rawKey.slice(0, 4)}-${rawKey.slice(4, 8)}-${rawKey.slice(8, 12)}`;

  let daysToAdd = 0;
  const amount = Number(transferAmount);

  if (amount >= 300000) {
    daysToAdd = 180; // 6 Tháng
  } else if (amount >= 59000) {
    daysToAdd = 30;  // 1 Tháng
  } else if (amount >= 2000) {
    daysToAdd = 5 / (24 * 60); // Test 5 phút
  }

  if (daysToAdd > 0) {
    const currentExpire = licenses[fullDeviceId] && new Date(licenses[fullDeviceId].expire_date) > new Date()
      ? new Date(licenses[fullDeviceId].expire_date)
      : new Date();

    const newExpire = new Date(currentExpire.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
    licenses[fullDeviceId] = {
      expire_date: newExpire.toISOString(),
      updated_at: new Date().toISOString()
    };

    saveLicenses(licenses);
    console.log(`-> MỞ KHÓA THÀNH CÔNG cho thiết bị ${fullDeviceId} đến ${newExpire.toISOString()}`);
  }

  return res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));