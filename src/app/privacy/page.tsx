import type { Metadata } from "next";

/**
 * Public privacy policy (no login). Meta needs its URL in the app's Basic settings
 * before the app can go Live and receive real WhatsApp messages and lead-ad leads.
 * Kept static and outside the auth proxy (see src/proxy.ts).
 */

export const metadata: Metadata = {
  title: "Privacy Policy — Full Speed Logistics",
  description: "How Full Speed Logistics handles data received from WhatsApp and Facebook lead ads.",
};

const UPDATED = "2026-11-23";

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-10 px-4 py-10 leading-7">
      <section dir="ltr" lang="en" className="space-y-4">
        <h1 className="text-2xl font-extrabold">Privacy Policy</h1>
        <p className="text-sm text-zinc-500">Full Speed Logistics — last updated {UPDATED}</p>
        <p>
          This policy explains how Full Speed Logistics (&quot;we&quot;) handles personal data in our internal recruitment
          system at ams.fullspeedlogistics.com, including data we receive through Meta products (WhatsApp Business
          Platform and Facebook lead ads).
        </p>
        <h2 className="text-lg font-bold">What we collect</h2>
        <ul className="list-disc space-y-1 ps-6">
          <li>Details you submit in our Facebook lead-ad forms, such as your name, phone number, city and the answers in the form.</li>
          <li>Messages you send to our WhatsApp business number, your WhatsApp profile name and phone number, and delivery status of our replies.</li>
        </ul>
        <h2 className="text-lg font-bold">How we use it</h2>
        <p>
          Only to contact you about the job or delivery opportunity you asked about, to process your application, and to
          route your request to the right partner company. We do not sell your data and we do not use it for unrelated advertising.
        </p>
        <h2 className="text-lg font-bold">Who can see it</h2>
        <p>
          Authorised Full Speed staff, and the partner company your application is for. Data is stored with our hosting and
          database providers under their security controls. Meta processes the data as described in its own policies.
        </p>
        <h2 className="text-lg font-bold">How long we keep it</h2>
        <p>As long as needed for recruitment and to meet legal obligations, then it is deleted or anonymised.</p>
        <h2 className="text-lg font-bold">Your choices and data deletion</h2>
        <p>
          You can ask us at any time to access, correct or delete your data, or to stop contacting you. Send the word
          &quot;delete&quot; with your phone number to our WhatsApp business number or as a message to the Full Speed Facebook
          page, and we will delete your data within 30 days and confirm.
        </p>
      </section>

      <hr className="border-zinc-200" />

      <section dir="rtl" lang="ar" className="space-y-4">
        <h1 className="text-2xl font-extrabold">سياسة الخصوصية</h1>
        <p className="text-sm text-zinc-500">فول سبيد لوجيستكس — آخر تحديث {UPDATED}</p>
        <p>
          السياسة دي بتوضح إزاي فول سبيد لوجيستكس بتتعامل مع البيانات الشخصية في سيستم التوظيف الداخلي
          ams.fullspeedlogistics.com، ومنها البيانات اللي بتوصلنا من واتساب بيزنس ومن فورم إعلانات فيسبوك.
        </p>
        <h2 className="text-lg font-bold">بنجمع إيه</h2>
        <ul className="list-disc space-y-1 ps-6">
          <li>البيانات اللي بتكتبها في فورم إعلاناتنا على فيسبوك، زي الاسم ورقم التليفون والمدينة وإجاباتك.</li>
          <li>الرسايل اللي بتبعتها لرقم الواتساب بتاعنا، واسمك ورقمك على واتساب، وحالة توصيل ردودنا.</li>
        </ul>
        <h2 className="text-lg font-bold">بنستخدمها في إيه</h2>
        <p>
          بس عشان نتواصل معاك بخصوص الشغل اللي سألت عليه، ونكمّل طلبك، ونوصّله للشركة المناسبة. مش بنبيع بياناتك
          ومش بنستخدمها في إعلانات ملهاش علاقة.
        </p>
        <h2 className="text-lg font-bold">مين يقدر يشوفها</h2>
        <p>موظفين فول سبيد المسموح لهم، والشركة اللي طلبك رايح لها. وبتتخزن عند مزوّدي الاستضافة وقاعدة البيانات.</p>
        <h2 className="text-lg font-bold">بنحتفظ بيها قد إيه</h2>
        <p>طول ما هي لازمة للتوظيف وللالتزامات القانونية، وبعدها بتتمسح.</p>
        <h2 className="text-lg font-bold">حقك ومسح البيانات</h2>
        <p>
          تقدر في أي وقت تطلب تشوف بياناتك أو تعدلها أو تمسحها أو نبطّل نكلمك. ابعت كلمة &quot;مسح&quot; مع رقمك على رقم
          الواتساب بتاعنا أو في رسالة لبيدج فول سبيد على فيسبوك، وهنمسحها خلال 30 يوم ونأكدلك.
        </p>
      </section>
    </main>
  );
}
