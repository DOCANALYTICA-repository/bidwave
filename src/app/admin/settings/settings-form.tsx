"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  adminSaveSettings,
  type SettingsActionState,
  type SettingsFormValues,
} from "@/app/admin/settings/actions";

const initialState: SettingsActionState = { status: "idle" };

function toLocalDatetimeInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function RepeatingRows<T extends Record<string, string>>({
  label,
  rows,
  onChange,
  fields,
  emptyRow,
}: {
  label: string;
  rows: T[];
  onChange: (rows: T[]) => void;
  fields: { key: keyof T; placeholder: string }[];
  emptyRow: T;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {rows.map((row, i) => (
        <div key={i} className="flex gap-2">
          {fields.map((f) => (
            <Input
              key={String(f.key)}
              value={row[f.key]}
              placeholder={f.placeholder}
              onChange={(e) => {
                const next = [...rows];
                next[i] = { ...next[i], [f.key]: e.target.value };
                onChange(next);
              }}
            />
          ))}
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
            Remove
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...rows, emptyRow])}>
        Add {label.toLowerCase().replace(/s$/, "")}
      </Button>
    </div>
  );
}

export function SettingsForm({ initial }: { initial: SettingsFormValues }) {
  const [state, formAction, isPending] = useActionState(adminSaveSettings, initialState);
  const [prizes, setPrizes] = useState(initial.prizes);
  const [faqs, setFaqs] = useState(initial.faqs);
  const [contacts, setContacts] = useState(initial.contacts);

  useEffect(() => {
    if (state.status === "success") toast.success("Settings saved.");
    if (state.status === "error" && state.formError) toast.error(state.formError);
  }, [state]);

  return (
    <form action={formAction} className="space-y-8">
      <input type="hidden" name="prizes" value={JSON.stringify(prizes)} />
      <input type="hidden" name="faqs" value={JSON.stringify(faqs)} />
      <input type="hidden" name="contacts" value={JSON.stringify(contacts)} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="whatsappLink">WhatsApp link</Label>
          <Input id="whatsappLink" name="whatsappLink" defaultValue={initial.whatsappLink} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="instagramUrl">Instagram URL</Label>
          <Input id="instagramUrl" name="instagramUrl" defaultValue={initial.instagramUrl} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="registrationFeeAmount">Registration fee amount</Label>
          <Input
            id="registrationFeeAmount"
            name="registrationFeeAmount"
            type="number"
            defaultValue={initial.registrationFeeAmount ?? ""}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="registrationFeeCurrency">Currency</Label>
          <Input id="registrationFeeCurrency" name="registrationFeeCurrency" defaultValue={initial.registrationFeeCurrency} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="registrationFeeNote">Fee note</Label>
          <Input id="registrationFeeNote" name="registrationFeeNote" defaultValue={initial.registrationFeeNote} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="paymentInstructions">Payment instructions</Label>
        <Textarea
          id="paymentInstructions"
          name="paymentInstructions"
          rows={4}
          defaultValue={initial.paymentInstructions}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="registrationOpensAt">Registration opens</Label>
          <Input
            id="registrationOpensAt"
            name="registrationOpensAt"
            type="datetime-local"
            defaultValue={toLocalDatetimeInput(initial.registrationOpensAt)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="registrationClosesAt">Registration closes</Label>
          <Input
            id="registrationClosesAt"
            name="registrationClosesAt"
            type="datetime-local"
            defaultValue={toLocalDatetimeInput(initial.registrationClosesAt)}
          />
        </div>
      </div>

      <RepeatingRows
        label="Prizes"
        rows={prizes}
        onChange={setPrizes}
        fields={[
          { key: "place", placeholder: "Place (e.g. 1st)" },
          { key: "detail", placeholder: "Detail (e.g. ₹10,000)" },
        ]}
        emptyRow={{ place: "", detail: "" }}
      />

      <RepeatingRows
        label="FAQs"
        rows={faqs}
        onChange={setFaqs}
        fields={[
          { key: "question", placeholder: "Question" },
          { key: "answer", placeholder: "Answer" },
        ]}
        emptyRow={{ question: "", answer: "" }}
      />

      <RepeatingRows
        label="Contacts"
        rows={contacts}
        onChange={setContacts}
        fields={[
          { key: "name", placeholder: "Name" },
          { key: "role", placeholder: "Role" },
          { key: "phone", placeholder: "Phone" },
        ]}
        emptyRow={{ name: "", role: "", phone: "" }}
      />

      {state.status === "error" && state.formError && <p className="text-sm text-unsold">{state.formError}</p>}
      <Button type="submit" disabled={isPending}>
        {isPending ? "Saving…" : "Save settings"}
      </Button>
    </form>
  );
}
