// Package ui has a constructor for each component: ui.Text("title") is
// hypereffect.NewElement("title", hypereffect.Text).
package ui

import he "github.com/hypereffect/hypereffect-go"

func Column(id string) *he.Element   { return he.NewElement(id, he.Column) }
func Row(id string) *he.Element      { return he.NewElement(id, he.Row) }
func Card(id string) *he.Element     { return he.NewElement(id, he.Card) }
func List(id string) *he.Element     { return he.NewElement(id, he.List) }
func Tabs(id string) *he.Element     { return he.NewElement(id, he.Tabs) }
func Tab(id string) *he.Element      { return he.NewElement(id, he.Tab) }
func Dialog(id string) *he.Element   { return he.NewElement(id, he.Dialog) }
func Text(id string) *he.Element     { return he.NewElement(id, he.Text) }
func Notice(id string) *he.Element   { return he.NewElement(id, he.Notice) }
func Badge(id string) *he.Element    { return he.NewElement(id, he.Badge) }
func Image(id string) *he.Element    { return he.NewElement(id, he.Image) }
func Divider(id string) *he.Element  { return he.NewElement(id, he.Divider) }
func Progress(id string) *he.Element { return he.NewElement(id, he.Progress) }
func Button(id string) *he.Element   { return he.NewElement(id, he.Button) }
func Input(id string) *he.Element    { return he.NewElement(id, he.Input) }
func Checkbox(id string) *he.Element { return he.NewElement(id, he.Checkbox) }
func Select(id string) *he.Element   { return he.NewElement(id, he.Select) }
func Slider(id string) *he.Element   { return he.NewElement(id, he.Slider) }
