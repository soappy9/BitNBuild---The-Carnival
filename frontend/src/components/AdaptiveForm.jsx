import { useState } from "react";
import "./AdaptiveForm.css";

const REVIEW_THRESHOLD = 90;

const LOCALE_RULES = {
  UAE: {
    label: "United Arab Emirates",
    fields: [
      { name: "fullName", label: "Full Name", type: "text", required: true },
      { name: "emiratesId", label: "Emirates ID", type: "text", required: true },
      { name: "phone", label: "Phone Number", type: "tel", required: true },
      { name: "dateOfBirth", label: "Date of Birth", type: "date", required: true },
      {
        name: "language", label: "Preferred Language", type: "select", required: true,
        options: ["Arabic", "English"]
      },
    ],
  },

  UK: {
    label: "United Kingdom",
    fields: [
      { name: "fullName", label: "Full Name", type: "text", required: true },
      { name: "nhsNumber", label: "NHS Number", type: "text", required: true },
      { name: "postcode", label: "Postcode", type: "text", required: true },
      { name: "phone", label: "Phone Number", type: "tel", required: true },
      { name: "dateOfBirth", label: "Date of Birth", type: "date", required: true },
    ],
  },

  US: {
    label: "United States",
    fields: [
      { name: "fullName", label: "Full Name", type: "text", required: true },
      { name: "state", label: "State", type: "text", required: true },
      { name: "zipCode", label: "ZIP Code", type: "text", required: true },
      { name: "phone", label: "Phone Number", type: "tel", required: true },
      { name: "dateOfBirth", label: "Date of Birth", type: "date", required: true },
    ],
  },

  India: {
    label: "India",
    fields: [
      { name: "fullName", label: "Full Name", type: "text", required: true },
      { name: "aadhaar", label: "Aadhaar Number", type: "text", required: true },
      { name: "state", label: "State", type: "text", required: true },
      { name: "phone", label: "Phone Number", type: "tel", required: true },
      { name: "dateOfBirth", label: "Date of Birth", type: "date", required: true },
      {
        name: "language", label: "Preferred Language", type: "select", required: false,
        options: ["Hindi", "English", "Tamil", "Telugu", "Bengali", "Marathi", "Kannada", "Malayalam", "Gujarati", "Punjabi"]
      },
    ],
  },
};

function calculateConfidence(country, formData) {
  const rules = LOCALE_RULES[country];

  let deviations = 0;

  rules.fields.forEach((field) => {
    const value = formData[field.name];

    // Missing required field
    if (field.required && (!value || value.trim() === "")) {
      deviations += 1;
      return;
    }

    if (!value) return;

    // Basic country-specific checks
    if (field.name === "emiratesId") {
      if (!/^\d{15}$/.test(value.replace("-", ""))) {
        deviations += 1;
      }
    }

    if (field.name === "nhsNumber") {
      if (!/^\d{10}$/.test(value.replace(/\s/g, ""))) {
        deviations += 1;
      }
    }

    if (field.name === "aadhaar") {
      if (!/^\d{12}$/.test(value.replace(/\s/g, ""))) {
        deviations += 1;
      }
    }

    if (field.name === "zipCode") {
      if (!/^\d{5}$/.test(value)) {
        deviations += 1;
      }
    }

    if (field.name === "postcode") {
      if (!/^[A-Za-z0-9 ]{5,8}$/.test(value)) {
        deviations += 1;
      }
    }
  });

  const confidence = Math.max(0, 100 - deviations * 15);

  return {
    confidence,
    deviations,
  };
}

function buildNormalizedEntry(country, formData) {
  return {
    country,
    ...formData,
    normalizedAt: new Date().toISOString(),
  };
}

export default function AdaptiveForm() {
  const [country, setCountry] = useState("");
  const [formData, setFormData] = useState({});
  const [result, setResult] = useState(null);
  const [submitted, setSubmitted] = useState(false);

  const rules = country ? LOCALE_RULES[country] : null;

  function handleCountryChange(event) {
    const selectedCountry = event.target.value;

    setCountry(selectedCountry);
    setFormData({});
    setResult(null);
    setSubmitted(false);
  }

  function handleChange(event) {
    const { name, value } = event.target;

    setFormData((previous) => ({
      ...previous,
      [name]: value,
    }));
  }

  function handleSubmit(event) {
    event.preventDefault();

    if (!country) return;

    const { confidence, deviations } =
      calculateConfidence(country, formData);

    const normalizedEntry = buildNormalizedEntry(country, formData);

    const payload = {
      submissionId: crypto.randomUUID(),
      submittedAt: new Date().toISOString(),

      country,

      raw: formData,

      entry: normalizedEntry,

      confidence,

      deviations,

      reviewRequired: confidence <= REVIEW_THRESHOLD,

      source: "real",
    };

    setResult(payload);
    setSubmitted(true);

    console.log("SUBMISSION PAYLOAD:", payload);
  }

  return (
    <div className="adaptive-page">
      <div className="adaptive-card">

        <div className="header">
          <p className="eyebrow">VIGIL</p>

          <h1>Adaptive Patient Form</h1>

          <p className="subtitle">
            The form changes based on the patient's country and
            calculates structural confidence before submission.
          </p>
        </div>

        {/* COUNTRY SELECTOR */}

        <div className="country-section">
          <label htmlFor="country">
            Country / Background
          </label>

          <select
            id="country"
            value={country}
            onChange={handleCountryChange}
          >
            <option value="">
              Select a country
            </option>

            {Object.entries(LOCALE_RULES).map(
              ([code, rule]) => (
                <option key={code} value={code}>
                  {rule.label}
                </option>
              )
            )}
          </select>
        </div>

        {/* DYNAMIC FORM */}

        {rules && (
          <form onSubmit={handleSubmit}>

            <div className="fields">
              {rules.fields.map((field) => (
                <div className="field" key={field.name}>

                  <label htmlFor={field.name}>
                    {field.label}

                    {field.required && (
                      <span className="required">
                        *
                      </span>
                    )}
                  </label>

                  {field.type === "select" ? (
                    <select
                      id={field.name}
                      name={field.name}
                      value={formData[field.name] || ""}
                      onChange={handleChange}
                    >
                      <option value="">
                        Select...
                      </option>

                      {field.options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={field.name}
                      name={field.name}
                      type={field.type}
                      value={formData[field.name] || ""}
                      onChange={handleChange}
                    />
                  )}

                </div>
              ))}
            </div>

            <button type="submit">
              Submit Patient Entry
            </button>

          </form>
        )}

        {/* RESULT */}

        {submitted && result && (
          <div className="result-panel">

            <h2>Submission Analysis</h2>

            <div className="confidence-row">

              <div>
                <span className="result-label">
                  Structure Confidence
                </span>

                <strong>
                  {result.confidence}%
                </strong>
              </div>

              <div className="confidence-bar">
                <div
                  className="confidence-fill"
                  style={{
                    width: `${result.confidence}%`,
                  }}
                />
              </div>

            </div>

            <p>
              Deviations detected:{" "}
              <strong>{result.deviations}</strong>
            </p>

            {result.reviewRequired ? (
              <div className="review-warning">
                ⚠️ Confidence at or below {REVIEW_THRESHOLD}% — send to human review queue.
              </div>
            ) : (
              <div className="accepted">
                ✓ Confidence above {REVIEW_THRESHOLD}% — eligible for auto-accept.
              </div>
            )}

            <details>
              <summary>
                View normalized entry
              </summary>

              <pre>
                {JSON.stringify(
                  result.entry,
                  null,
                  2
                )}
              </pre>
            </details>

          </div>
        )}

      </div>
    </div>
  );
}