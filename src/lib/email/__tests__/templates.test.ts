import { test } from "node:test";
import assert from "node:assert/strict";
import { SAMPLE_TEMPLATES, paymentRejectedEmail, type TemplateContext } from "../templates";

const ctx: TemplateContext = {
  shop: { name: "TERMTEE", supportEmail: "help@example.com", supportLine: null, supportPhone: null, supportHours: null },
  appUrl: "https://termtee.example",
};

test("every sample template renders subject, html and text", () => {
  for (const [name, render] of Object.entries(SAMPLE_TEMPLATES)) {
    const mail = render(ctx);
    assert.ok(mail.subject.length > 0, name);
    assert.match(mail.html, /^<!doctype html>/, name);
    assert.ok(mail.text.includes("help@example.com"), name);
  }
});

test("user-provided text is escaped and links use APP_URL", () => {
  const mail = paymentRejectedEmail(ctx, {
    name: "<b>x</b>",
    orderId: "order1",
    eventTitle: "A & B",
    reason: `<script>alert("x")</script>`,
  });
  assert.ok(!mail.html.includes("<script>"));
  assert.ok(mail.html.includes("&lt;script&gt;"));
  assert.ok(mail.html.includes("A &amp; B"));
  assert.ok(mail.html.includes('href="https://termtee.example/pay/order1"'));
  assert.ok(mail.text.includes("https://termtee.example/pay/order1"));
});
