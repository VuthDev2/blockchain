import { jsPDF } from "jspdf";
import qrcode from "qrcode-generator";

export interface PdfCertificateData {
  certificateId: string;
  recipientName: string;
  certificateTitle: string;
  course: string;
  organizationName: string;
  issueDate: string;
  expirationDate: string | null;
  description?: string | null;
  grade?: string | null;
  instructorName?: string | null;
  transactionHash?: string | null;
  verificationUrl: string;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "No expiration";
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return value;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Draw a QR code (QR matrix from qrcode-generator) onto the PDF with rects. */
function drawQrCode(doc: jsPDF, text: string, x: number, y: number, size: number): void {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  const cell = size / count;

  // Quiet zone on the cream background.
  doc.setFillColor(255, 255, 255);
  doc.rect(x - 4, y - 4, size + 8, size + 8, "F");

  doc.setFillColor(27, 35, 56);
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) {
        doc.rect(x + c * cell, y + r * cell, cell, cell, "F");
      }
    }
  }
}

/** FR-07 — build the landscape A4 certificate PDF. Returns PDF bytes. */
export function buildCertificatePdf(cert: PdfCertificateData): Buffer {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();

  const ink: [number, number, number] = [27, 35, 56];
  const gold: [number, number, number] = [190, 148, 68];
  const grey: [number, number, number] = [110, 118, 136];

  doc.setFillColor(252, 251, 247);
  doc.rect(0, 0, width, height, "F");

  doc.setDrawColor(...ink);
  doc.setLineWidth(3);
  doc.rect(26, 26, width - 52, height - 52);
  doc.setDrawColor(...gold);
  doc.setLineWidth(1);
  doc.rect(36, 36, width - 72, height - 72);

  doc.setTextColor(...gold);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(cert.organizationName.toUpperCase(), width / 2, 90, { align: "center" });

  doc.setTextColor(...ink);
  doc.setFont("times", "bold");
  doc.setFontSize(34);
  doc.text(cert.certificateTitle.toUpperCase(), width / 2, 140, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(...grey);
  doc.text("This certifies that", width / 2, 176, { align: "center" });

  doc.setFont("times", "bolditalic");
  doc.setFontSize(40);
  doc.setTextColor(...ink);
  doc.text(cert.recipientName, width / 2, 224, { align: "center" });

  doc.setDrawColor(...gold);
  doc.setLineWidth(1);
  doc.line(width / 2 - 150, 238, width / 2 + 150, 238);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(...grey);
  doc.text("has successfully completed", width / 2, 264, { align: "center" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...ink);
  doc.text(cert.course, width / 2, 292, { align: "center" });

  if (cert.description) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...grey);
    const lines = doc.splitTextToSize(cert.description, width - 320);
    doc.text(lines.slice(0, 3), width / 2, 314, { align: "center" });
  }

  const baseY = height - 130;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...grey);
  doc.text(`Issued: ${formatDate(cert.issueDate)}`, 70, baseY);
  doc.text(
    cert.expirationDate ? `Expires: ${formatDate(cert.expirationDate)}` : "Expires: No expiration",
    70,
    baseY + 16,
  );
  if (cert.grade) doc.text(`Grade: ${cert.grade}`, 70, baseY + 32);

  doc.setFont("courier", "normal");
  doc.setTextColor(...ink);
  doc.text(`Certificate ID: ${cert.certificateId}`, 70, baseY + (cert.grade ? 50 : 34));

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...grey);
  const shortTx = cert.transactionHash
    ? `${cert.transactionHash.slice(0, 18)}…${cert.transactionHash.slice(-8)}`
    : "pending";
  doc.text(`Blockchain tx: ${shortTx}`, 70, baseY + (cert.grade ? 66 : 50));

  if (cert.instructorName) {
    doc.setDrawColor(...ink);
    doc.line(width / 2 - 90, baseY + 20, width / 2 + 90, baseY + 20);
    doc.setFontSize(10);
    doc.setTextColor(...ink);
    doc.text(cert.instructorName, width / 2, baseY + 36, { align: "center" });
    doc.setFontSize(8);
    doc.setTextColor(...grey);
    doc.text("Authorized signature", width / 2, baseY + 50, { align: "center" });
  }

  drawQrCode(doc, cert.verificationUrl, width - 168, baseY - 42, 96);
  doc.setFontSize(7);
  doc.setTextColor(...grey);
  const urlLines = doc.splitTextToSize(cert.verificationUrl, 150);
  doc.text(urlLines, width - 120, baseY + 66, { align: "center" });

  const output = doc.output("arraybuffer");
  return Buffer.from(output);
}
