//! A plugin that imports contacts from pasted CSV into a host application.
//! It runs sandboxed as WebAssembly and asks how to read the data through
//! the host's renderer: one dropdown per column, a preview, and progress.

use hypereffect::ui::*;
use hypereffect::{cel, json, Action, App, Handler, Map, Outbox, Value};

const SAMPLE: &str = "First name,Last name,Email,Phone,Company
Ada,Lovelace,ada@analytical.org,+44 20 7946 0018,Analytical Engines
Grace,Hopper,grace@navy.example,,US Navy
Alan,Turing,alan.turing@bletchley,+44 1908 640404,Bletchley Park
,,info@example.com,,Example Ltd
Katherine,Johnson,katherine@nasa.example,,NASA
Edsger,Dijkstra,ewd@cs.utexas.edu,,UT Austin";

const FIELDS: [(&str, &str); 5] = [
    ("name", "Name"),
    ("email", "Email"),
    ("phone", "Phone"),
    ("company", "Company"),
    ("skip", "Don’t import"),
];
const PREVIEW: usize = 8;
const ROWS_PER_TICK: usize = 1;

struct Contact {
    name: String,
    email: String,
    phone: String,
    company: String,
}

impl Contact {
    fn problem(&self) -> Option<&'static str> {
        if self.name.is_empty() {
            Some("no name")
        } else if !self.email.is_empty() && !valid_email(&self.email) {
            Some("invalid email")
        } else {
            None
        }
    }

    fn summary(&self) -> String {
        let parts = [&self.name, &self.email, &self.phone, &self.company];
        let s: Vec<&str> = parts.iter().map(|p| p.as_str()).filter(|p| !p.is_empty()).collect();
        if s.is_empty() {
            "(empty row)".into()
        } else {
            s.join(" · ")
        }
    }
}

fn valid_email(s: &str) -> bool {
    match s.split_once('@') {
        Some((user, host)) => {
            !user.is_empty() && host.contains('.') && !host.starts_with('.') && !host.ends_with('.')
        }
        None => false,
    }
}

/// Splits text into records, using the delimiter that is most common in the
/// first line: commas, semicolons, or tabs as pasted from a spreadsheet.
fn parse_csv(text: &str) -> Vec<Vec<String>> {
    let first = text.lines().next().unwrap_or("");
    let delim = [',', ';', '\t']
        .into_iter()
        .max_by_key(|d| first.matches(*d).count())
        .unwrap_or(',');
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' if quoted && chars.peek() == Some(&'"') => {
                field.push('"');
                chars.next();
            }
            '"' => quoted = !quoted,
            c if c == delim && !quoted => row.push(std::mem::take(&mut field).trim().to_string()),
            '\r' if !quoted => {}
            '\n' if !quoted => {
                row.push(std::mem::take(&mut field).trim().to_string());
                rows.push(std::mem::take(&mut row));
            }
            c => field.push(c),
        }
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field.trim().to_string());
        rows.push(row);
    }
    rows.retain(|r| r.iter().any(|f| !f.is_empty()));
    rows
}

/// The field a column probably holds, from its header.
fn guess(header: &str) -> &'static str {
    let h = header.to_lowercase();
    if h.contains("mail") {
        "email"
    } else if h.contains("phone") || h.contains("tel") || h.contains("mobile") {
        "phone"
    } else if h.contains("company") || h.contains("organi") || h.contains("employer") {
        "company"
    } else if h.contains("name") {
        "name"
    } else {
        "skip"
    }
}

#[derive(PartialEq, Eq, Clone, Copy)]
enum Stage {
    Edit,
    Importing,
    Done,
}

pub struct Import {
    csv: String,
    header: bool,
    columns: Vec<String>,
    map: Vec<&'static str>,
    records: Vec<Vec<String>>,
    contacts: Vec<Contact>,
    /// How many preview rows and column dropdowns are on the surface.
    shown_rows: usize,
    shown_columns: usize,
    stage: Stage,
    imported: usize,
}

impl Default for Import {
    fn default() -> Self {
        Import {
            csv: SAMPLE.into(),
            header: true,
            columns: Vec::new(),
            map: Vec::new(),
            records: Vec::new(),
            contacts: Vec::new(),
            shown_rows: 0,
            shown_columns: 0,
            stage: Stage::Edit,
            imported: 0,
        }
    }
}

impl Import {
    /// Reads the CSV again, keeping the field chosen for a column whose
    /// heading did not change.
    fn parse(&mut self) {
        let mut rows = parse_csv(&self.csv);
        let width = rows.iter().map(Vec::len).max().unwrap_or(0);
        let heads: Vec<String> = if self.header && !rows.is_empty() {
            let h = rows.remove(0);
            (0..width)
                .map(|i| match h.get(i) {
                    Some(s) if !s.is_empty() => s.clone(),
                    _ => format!("Column {}", i + 1),
                })
                .collect()
        } else {
            (0..width).map(|i| format!("Column {}", i + 1)).collect()
        };
        self.map = heads
            .iter()
            .enumerate()
            .map(|(i, h)| match self.columns.get(i) {
                Some(old) if old == h => self.map[i],
                _ if self.header => guess(h),
                _ => "skip",
            })
            .collect();
        self.columns = heads;
        self.records = rows;
        self.build();
    }

    /// Builds contacts from the records with the current mapping. Columns
    /// mapped to the same field are joined, such as first and last name.
    fn build(&mut self) {
        self.contacts = self
            .records
            .iter()
            .map(|r| {
                let field = |name: &str| {
                    let parts: Vec<&str> = self
                        .map
                        .iter()
                        .enumerate()
                        .filter(|(_, f)| **f == name)
                        .filter_map(|(i, _)| r.get(i).map(String::as_str))
                        .filter(|s| !s.is_empty())
                        .collect();
                    parts.join(" ")
                };
                Contact {
                    name: field("name"),
                    email: field("email"),
                    phone: field("phone"),
                    company: field("company"),
                }
            })
            .collect();
    }

    fn ready(&self) -> usize {
        self.contacts.iter().filter(|c| c.problem().is_none()).count()
    }

    fn state(&self) -> Value {
        let ready = self.ready();
        let skipped = self.contacts.len() - ready;
        let mut map = Map::new();
        for (i, f) in self.map.iter().enumerate() {
            map.insert(format!("c{i}"), (*f).into());
        }
        json!({
            "map": map,
            "total": self.contacts.len(),
            "ready": ready,
            "summary": match skipped {
                0 => format!("{} rows", self.contacts.len()),
                n => format!("{} rows, {n} will be skipped", self.contacts.len()),
            },
            "stage": match self.stage {
                Stage::Edit => "edit",
                Stage::Importing => "importing",
                Stage::Done => "done",
            },
            "imported": self.imported,
            "progress": if ready > 0 { self.imported as f64 / ready as f64 } else { 0.0 },
        })
    }

    /// Sends the column dropdowns and preview rows, replacing those already
    /// shown and removing the ones left over.
    fn render(&mut self, out: &mut Outbox) {
        let options = Value::Array(
            FIELDS
                .iter()
                .map(|(value, label)| json!({ "value": value, "label": label }))
                .collect(),
        );
        for (i, head) in self.columns.iter().enumerate() {
            out.element(
                select(format!("col-{i}"))
                    .parent("columns")
                    .label(head.as_str())
                    .bind(format!("map.c{i}"))
                    .options(options.clone())
                    .disabled(cel("s.stage == 'importing'"))
                    .on_change(Handler::action("map")),
            );
        }
        for i in self.columns.len()..self.shown_columns {
            out.remove(format!("col-{i}"));
            out.signal(json!({ "map": { format!("c{i}"): null } }));
        }
        self.shown_columns = self.columns.len();

        let rows = self.contacts.len().min(PREVIEW);
        for (i, c) in self.contacts.iter().take(rows).enumerate() {
            let id = format!("r{i}");
            let problem = c.problem();
            out.element(row(id.as_str()).parent("preview").justify("between"));
            out.element(text(format!("{id}-text")).parent(id.as_str()).text(c.summary()));
            out.element(
                badge(format!("{id}-badge"))
                    .parent(id.as_str())
                    .variant("warning")
                    .text(problem.unwrap_or(""))
                    .visible(problem.is_some()),
            );
        }
        for i in rows..self.shown_rows {
            out.remove(format!("r{i}"));
        }
        self.shown_rows = rows;
    }
}

impl App for Import {
    fn hello(&mut self, out: &mut Outbox, _signals: &Map<String, Value>) {
        self.parse();
        out.signal(json!({ "csv": self.csv, "header": self.header }));
        out.signal(self.state());
        out.element(card("import").title("Import contacts"));
        out.element(text("intro").parent("import").variant("caption").text(
            "A plugin running sandboxed as WebAssembly. Paste rows from a spreadsheet \
             and choose what each column holds.",
        ));
        out.element(
            input("csv")
                .parent("import")
                .variant("multiline")
                .label("Data")
                .bind("csv")
                .disabled(cel("s.stage == 'importing'"))
                .on_change(Handler::action("parse")),
        );
        out.element(
            checkbox("header")
                .parent("import")
                .label("The first row has column names")
                .bind("header")
                .disabled(cel("s.stage == 'importing'"))
                .on_change(Handler::action("parse")),
        );
        out.element(text("columns-title").parent("import").variant("h3").text("Columns"));
        out.element(row("columns").parent("import").wrap(true).align("start"));
        out.element(text("preview-title").parent("import").variant("h3").text("Preview"));
        out.element(list("preview").parent("import").empty("No rows to import."));
        out.element(
            text("more")
                .parent("import")
                .variant("caption")
                .text(cel(format!("'and ' + string(s.total - {PREVIEW}) + ' more'")))
                .visible(cel(format!("s.total > {PREVIEW}"))),
        );
        out.element(
            progress("progress")
                .parent("import")
                .label(cel("'Importing ' + string(s.imported) + ' of ' + string(s.ready)"))
                .value(cel("s.progress"))
                .visible(cel("s.stage == 'importing'")),
        );
        out.element(
            notice("done")
                .parent("import")
                .variant("success")
                .title("Import finished")
                .text(cel("string(s.imported) + ' contacts were added.'"))
                .visible(cel("s.stage == 'done'")),
        );
        out.element(row("footer").parent("import").justify("between"));
        out.element(text("summary").parent("footer").variant("caption").text(cel("s.summary")));
        out.element(
            button("go")
                .parent("footer")
                .variant("primary")
                .label(cel("s.ready == 1 ? 'Import 1 contact' : 'Import ' + string(s.ready) + ' contacts'"))
                .disabled(cel("s.ready == 0 || s.stage != 'edit'"))
                .on_press(Handler::action("import")),
        );
        self.render(out);
    }

    fn action(&mut self, out: &mut Outbox, action: &Action) {
        if self.stage == Stage::Importing {
            return;
        }
        match action.name.as_str() {
            "parse" => {
                if let Some(csv) = action.signal("csv").and_then(Value::as_str) {
                    self.csv = csv.into();
                }
                if let Some(h) = action.signal("header").and_then(Value::as_bool) {
                    if h != self.header {
                        // Column names become data, or the other way round.
                        self.columns.clear();
                    }
                    self.header = h;
                }
                self.stage = Stage::Edit;
                self.parse();
            }
            "map" => {
                for (i, f) in self.map.iter_mut().enumerate() {
                    let chosen = action.signal(&format!("map.c{i}")).and_then(Value::as_str);
                    if let Some(&(name, _)) = FIELDS.iter().find(|(n, _)| Some(*n) == chosen) {
                        *f = name;
                    }
                }
                self.stage = Stage::Edit;
                self.build();
            }
            "import" if self.stage == Stage::Edit && self.ready() > 0 => {
                self.stage = Stage::Importing;
                self.imported = 0;
            }
            _ => {}
        }
        self.render(out);
        out.signal(self.state());
    }

    fn tick(&mut self, out: &mut Outbox, _now_ms: f64) {
        if self.stage != Stage::Importing {
            return;
        }
        self.imported = (self.imported + ROWS_PER_TICK).min(self.ready());
        if self.imported == self.ready() {
            self.stage = Stage::Done;
        }
        out.signal(self.state());
    }

    fn tick_interval(&self) -> Option<u32> {
        (self.stage == Stage::Importing).then_some(400)
    }
}

hypereffect::wasm_app!(Import);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_quotes_and_tabs() {
        assert_eq!(
            parse_csv("a,\"b, \"\"c\"\"\"\n\n1,2"),
            vec![vec!["a", "b, \"c\""], vec!["1", "2"]]
        );
        assert_eq!(parse_csv("a\tb,c\n1\t2"), vec![vec!["a", "b,c"], vec!["1", "2"]]);
    }
}
