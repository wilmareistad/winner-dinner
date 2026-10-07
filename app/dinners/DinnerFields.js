// The fields User 1 fills in for a dinner. Shared by the create and edit forms.
// Limits match the checks in the database (check_dinner_fields).
export default function DinnerFields({ values = {}, minDate }) {
  return (
    <>
      <label>
        Main course
        <input name="main_title" maxLength={100} required defaultValue={values.main_title ?? ""} />
      </label>
      <label>
        Description <span className="muted">(optional)</span>
        <textarea
          name="main_description"
          maxLength={1000}
          rows={3}
          defaultValue={values.main_description ?? ""}
        />
      </label>
      <label>
        Recipe link <span className="muted">(optional)</span>
        <input
          name="main_url"
          type="url"
          maxLength={500}
          placeholder="https://"
          defaultValue={values.main_url ?? ""}
        />
      </label>
      <div className="row">
        <label>
          Date
          <input name="date" type="date" min={minDate} required defaultValue={values.date ?? ""} />
        </label>
        <label>
          Time <span className="muted">(Swedish time)</span>
          <input name="time" type="time" required defaultValue={values.time ?? ""} />
        </label>
      </div>
      <label>
        Short description <span className="muted">(optional)</span>
        <input
          name="short_description"
          maxLength={200}
          defaultValue={values.short_description ?? ""}
        />
      </label>
      <label>
        Invitation summary <span className="muted">(optional, guests see it)</span>
        <textarea
          name="invitation_summary"
          maxLength={1000}
          rows={3}
          defaultValue={values.invitation_summary ?? ""}
        />
      </label>
    </>
  );
}
