<svelte:head>
    <title>SIVACOR – Privacy Policy</title>
</svelte:head>

<main class="privacy-container">
    <article class="privacy-content">
        <header>
            <a href="/" class="back-link">
                <span class="material-icons">arrow_back</span>
                Back to SIVACOR
            </a>
            <h1>Privacy Policy</h1>
            <p class="last-updated">Last updated: 6 August 2026</p>
        </header>

        <section>
            <h2>1. Data Controller</h2>
            <p>
                The data controller responsible for your personal data is the
                <strong>SIVACOR Team</strong>, which operates the SIVACOR
                service at <code>*.sivacor.org</code>.
            </p>
            <p>
                For any privacy-related enquiries, please contact:
                <a href="mailto:support@sivacor.org">support@sivacor.org</a>.
            </p>
        </section>

        <section>
            <h2>2. What Personal Data We Collect</h2>
            <table>
                <thead>
                    <tr>
                        <th>Data</th>
                        <th>Source</th>
                        <th>Where stored</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Email address, first name, last name</td>
                        <td>Provided at login via Globus/ORCID OAuth</td>
                        <td>Girder backend (<code>girder.sivacor.org</code>)</td
                        >
                    </tr>
                    <tr>
                        <td>ORCID iD</td>
                        <td>ORCID OAuth login</td>
                        <td>Girder backend</td>
                    </tr>
                    <tr>
                        <td>Authentication token (<code>girderToken</code>)</td>
                        <td>Issued by the server after login</td>
                        <td>Browser cookie (7-day expiry)</td>
                    </tr>
                    <tr>
                        <td
                            >Last-used job configuration (image, tag, filename)</td
                        >
                        <td>Saved automatically after job submission</td>
                        <td
                            >Browser <code>localStorage</code> on your device only</td
                        >
                    </tr>
                    <tr>
                        <td>Uploaded research archive files</td>
                        <td>Uploaded by you when submitting a job</td>
                        <td>Girder backend (retained for 14 days)</td>
                    </tr>
                    <tr>
                        <td>Job results and output artefacts</td>
                        <td>Produced by the SIVACOR pipeline</td>
                        <td>Girder backend (retained for 14 days)</td>
                    </tr>
                    <tr>
                        <td
                            >Server access logs (IP address, request metadata)</td
                        >
                        <td>Collected automatically on every request</td>
                        <td>Server infrastructure logs</td>
                    </tr>
                </tbody>
            </table>
        </section>

        <section>
            <h2>3. Legal Basis for Processing</h2>
            <p>
                We process your personal data on the following legal bases under
                Article 6 GDPR:
            </p>
            <ul>
                <li>
                    <strong>Contract performance (Article 6(1)(b)):</strong> Processing
                    your account details, authentication token, uploaded files, and
                    sending job-result notifications is necessary to provide the
                    SIVACOR service you have requested.
                </li>
                <li>
                    <strong>Legitimate interests (Article 6(1)(f)):</strong> Server
                    access logs are retained for security monitoring and to diagnose
                    technical problems. These interests are not overridden by your
                    rights given the limited scope of the data collected.
                </li>
                <li>
                    <strong>Legitimate interests (Article 6(1)(f)):</strong> When
                    a job finishes we derive an anonymous statistical record of
                    how it ran (see section 7). We need this to diagnose recurring
                    failures and to report on the service to its funders. The
                    processing consists of reducing your job to figures that
                    identify no one, and the result cannot be traced back to you,
                    so the impact on your rights is minimal.
                </li>
            </ul>
        </section>

        <section>
            <h2>4. How We Use Your Data</h2>
            <ul>
                <li>To authenticate you and maintain your login session.</li>
                <li>
                    To run the SIVACOR reproducibility pipeline on files you
                    upload.
                </li>
                <li>
                    To send a transactional email notification to your
                    registered address when a job completes. You will be
                    informed of the recipient address at the point of
                    submission.
                </li>
                <li>
                    To detect and investigate security incidents via server
                    logs.
                </li>
                <li>
                    To compile anonymous statistics on how the service performs
                    — how often jobs succeed or fail and why — for debugging and
                    for reporting to the project's funders. See section 7.
                </li>
            </ul>
        </section>

        <section>
            <h2>5. Data Sharing with Third Parties</h2>
            <p>
                We do not sell or rent your personal data. Limited sharing
                occurs in the following cases:
            </p>
            <ul>
                <li>
                    <strong>Globus (globus.org):</strong> If you log in via Globus,
                    your browser is redirected to Globus's OAuth endpoint. Globus's
                    own privacy policy governs that interaction. We receive and store
                    only your Globus iD and the email address your Globus profile
                    makes available.
                </li>
                <li>
                    <strong>ORCID (orcid.org):</strong> If you log in via ORCID,
                    your browser is redirected to ORCID's OAuth endpoint. ORCID's
                    own privacy policy governs that interaction. We receive and store
                    only your ORCID iD and the email address your ORCID profile makes
                    available.
                </li>
                <li>
                    <strong>Infrastructure providers:</strong> The service runs on
                    hosting infrastructure whose operators may have incidental access
                    to server logs in the course of operating the service.
                </li>
            </ul>
            <p>
                No third-party tracking, analytics, or advertising service
                receives your data. The anonymous operational statistics
                described in section 7 are produced and held by us alone and are
                not shared with any third party in a form that identifies you.
                Since Step 1 of our GDPR implementation, fonts and icons are
                served directly from this application — no external font CDN
                requests are made.
            </p>
        </section>

        <section>
            <h2>6. Data Retention</h2>
            <ul>
                <li>
                    <strong>Uploaded archives and job output files:</strong> Retained
                    for <strong>14 days from the time you submit the job</strong>,
                    so that you can retrieve your results, and deleted automatically
                    after that. Note that the period runs from submission, not from
                    completion — a job that takes two days to run leaves you twelve
                    days to download its output. You can delete your own submissions
                    at any time using the delete button in the job list. Contact
                    us if you need data removed sooner.
                </li>
                <li>
                    <strong>Account data (email, name, ORCID iD):</strong> Retained
                    for as long as you hold an active account. Deleted upon account
                    deletion request.
                </li>
                <li>
                    <strong>Authentication token:</strong> The
                    <code>girderToken</code>
                    cookie expires automatically after 7 days.
                </li>
                <li>
                    <strong
                        >Local job configuration (<code>localStorage</code
                        >):</strong
                    >
                    Stored only in your browser. Clear your browser storage at any
                    time to remove it.
                </li>
                <li>
                    <strong>Server access logs:</strong> Retained in accordance with
                    the standard operational policy of the hosting infrastructure,
                    typically no longer than 90 days.
                </li>
                <li>
                    <strong>Anonymous operational records:</strong> Kept
                    indefinitely. These contain no personal data — see section 7.
                </li>
            </ul>
        </section>

        <section>
            <h2>7. Anonymous Operational Records</h2>
            <p>
                Everything above is deleted on the schedule described in section
                6. That would leave us unable to answer basic questions about
                the service — how often runs fail, on which analysis
                environments, and why — so when a job reaches its final state we
                also write a small statistical record of how it ran, and keep
                that indefinitely.
            </p>
            <p>These records contain only:</p>
            <ul>
                <li>the date (not the time) the job finished;</li>
                <li>
                    whether it succeeded, failed, or was abandoned, and for
                    failures a category such as <em>out of disk space</em> or
                    <em>the analysis exited with an error</em>;
                </li>
                <li>
                    which analysis environment was used (for example
                    <code>rocker/r-ver:4.6.1</code>), how long the run took, and
                    how much processor and memory it used;
                </li>
                <li>
                    the size of the uploaded package as a broad range (for
                    example <em>10–100&nbsp;MB</em>), never an exact size;
                </li>
                <li>the processor architecture and core count of the machine that ran it.</li>
            </ul>
            <p>
                They deliberately contain <strong>no identifier of any kind</strong>:
                no user, account, job or submission reference, no name, no email
                address, no ORCID iD, and no filename, file path, or content
                from your uploaded package. There is no key that would let us —
                or anyone else — link a record back to you or to a particular
                submission. Error messages are reduced to a fixed list of
                categories before being stored, precisely so that text taken
                from your own files cannot end up in them.
            </p>
            <p>
                Because these records are anonymous, they are not personal data
                and the rights in section 9 do not apply to them: there is
                nothing in them to give you a copy of, correct, or delete. Your
                submission and everything identifying it are still deleted in
                full, on request or on the 14-day schedule.
            </p>
        </section>

        <section>
            <h2>8. Cookies and Browser Storage</h2>
            <p>
                SIVACOR uses only functional storage — no tracking or
                advertising cookies:
            </p>
            <ul>
                <li>
                    <strong><code>girderToken</code> (cookie):</strong> Keeps you
                    logged in for up to 7 days. Strictly necessary for the service
                    to function.
                </li>
                <li>
                    <strong
                        ><code>sivacor_config_entries</code> (localStorage):</strong
                    >
                    Remembers your last-used Docker image, tag, and filename to pre-fill
                    the job submission form. Stored only on your device.
                </li>
                <li>
                    <strong
                        ><code>bannerDismissed</code>,
                        <code>orcidEmailWarningSeen</code> (sessionStorage):</strong
                    >
                    Suppresses notices you have already seen during the current browser
                    session. Cleared when you close the tab.
                </li>
            </ul>
            <p>
                No third-party cookies are set. No consent gate is required for
                the above as all storage is strictly necessary or limited to
                your own device.
            </p>
        </section>

        <section>
            <h2>9. Your Rights Under GDPR</h2>
            <p>
                As a data subject you have the following rights, exercisable
                free of charge:
            </p>
            <ul>
                <li>
                    <strong>Right of access (Article 15):</strong> Request a copy
                    of the personal data we hold about you.
                </li>
                <li>
                    <strong>Right to rectification (Article 16):</strong> Request
                    correction of inaccurate data.
                </li>
                <li>
                    <strong>Right to erasure (Article 17):</strong> Request deletion
                    of your account and associated personal data. We will act within
                    30 days.
                </li>
                <li>
                    <strong>Right to restrict processing (Article 18):</strong> Ask
                    us to pause processing under certain circumstances.
                </li>
                <li>
                    <strong>Right to data portability (Article 20):</strong> Request
                    a machine-readable copy of data you have provided to us.
                </li>
                <li>
                    <strong>Right to object (Article 21):</strong> Object to processing
                    based on legitimate interests.
                </li>
            </ul>
            <p>
                To exercise any of these rights, contact
                <a href="mailto:support@sivacor.org">support@sivacor.org</a>. We
                will respond within 30 days. You also have the right to lodge a
                complaint with your local supervisory authority (e.g., the
                Austrian Datenschutzbehörde or the German Bundesbeauftragte für
                den Datenschutz).
            </p>
        </section>

        <section>
            <h2>10. Changes to This Policy</h2>
            <p>
                We may update this policy from time to time. Material changes
                will be announced via a banner on the application. The "Last
                updated" date at the top of this page will always reflect the
                most recent revision.
            </p>
        </section>
    </article>
</main>

<style>
    .privacy-container {
        min-height: 100vh;
        background: var(--md-background);
        padding: var(--md-spacing-xxl) var(--md-spacing-lg);
    }

    .privacy-content {
        max-width: 800px;
        margin: 0 auto;
        background: var(--md-surface);
        border-radius: 8px;
        box-shadow: var(--md-elevation-1);
        padding: var(--md-spacing-xxl);
    }

    .back-link {
        display: inline-flex;
        align-items: center;
        gap: var(--md-spacing-xs);
        color: var(--md-primary);
        text-decoration: none;
        font-size: 0.875rem;
        font-weight: 500;
        margin-bottom: var(--md-spacing-lg);
    }

    .back-link:hover {
        text-decoration: underline;
    }

    .back-link .material-icons {
        font-size: 1rem;
    }

    header h1 {
        font-size: 2rem;
        font-weight: 300;
        color: var(--md-on-surface);
        margin: 0 0 var(--md-spacing-xs) 0;
    }

    .last-updated {
        font-size: 0.875rem;
        color: var(--md-on-surface-variant);
        margin: 0 0 var(--md-spacing-xxl) 0;
    }

    section {
        margin-bottom: var(--md-spacing-xxl);
    }

    h2 {
        font-size: 1.125rem;
        font-weight: 500;
        color: var(--md-on-surface);
        margin: 0 0 var(--md-spacing-md) 0;
        padding-bottom: var(--md-spacing-xs);
        border-bottom: 1px solid var(--md-outline);
    }

    p {
        color: var(--md-on-surface-variant);
        line-height: 1.7;
        margin: 0 0 var(--md-spacing-md) 0;
    }

    ul {
        color: var(--md-on-surface-variant);
        line-height: 1.7;
        padding-left: var(--md-spacing-lg);
        margin: 0 0 var(--md-spacing-md) 0;
    }

    li {
        margin-bottom: var(--md-spacing-sm);
    }

    a {
        color: var(--md-primary);
    }

    code {
        background: var(--md-surface-variant);
        padding: 1px 5px;
        border-radius: 3px;
        font-size: 0.875em;
    }

    table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.875rem;
        color: var(--md-on-surface-variant);
        margin-bottom: var(--md-spacing-md);
    }

    th {
        background: var(--md-surface-variant);
        color: var(--md-on-surface);
        font-weight: 500;
        text-align: left;
        padding: var(--md-spacing-sm) var(--md-spacing-md);
        border: 1px solid var(--md-outline);
    }

    td {
        padding: var(--md-spacing-sm) var(--md-spacing-md);
        border: 1px solid var(--md-outline);
        vertical-align: top;
    }

    tr:nth-child(even) td {
        background: var(--md-surface-variant);
    }

    @media (max-width: 600px) {
        .privacy-content {
            padding: var(--md-spacing-lg);
        }

        table,
        thead,
        tbody,
        th,
        td,
        tr {
            display: block;
        }

        thead {
            display: none;
        }

        td {
            border: none;
            border-bottom: 1px solid var(--md-outline);
            padding-left: var(--md-spacing-sm);
        }
    }
</style>
