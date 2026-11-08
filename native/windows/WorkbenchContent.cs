using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Media;
using Markdig;
using Markdig.Syntax;
using Markdig.Syntax.Inlines;

namespace Papercusp.Workbench
{
    // Native projection of the shared operator-ui parse-work-refs and
    // chat-ref-popup-params contracts. C# strings retain JS UTF-16 offsets.
    public static class NativeWorkRefs
    {
        public static Match[] Parse(string text)
        {
            var scan = text ?? "";
            foreach (var pattern in new[] { @"```[\s\S]*?(?:```|$)", @"(`+)[\s\S]*?\1", @"!?\[[^\]]*\]\([^)]*\)" })
                scan = Regex.Replace(scan, pattern, match => new string(' ', match.Length));
            return Regex.Matches(scan, @"(?<![A-Za-z0-9_])(?:(?:WI|EI|F)-[0-9]+|P-[0-9]{3,})(?![A-Za-z0-9_])").Cast<Match>().ToArray();
        }
        public static string Target(string id, Dictionary<string, object> environment, string harness, string plan)
        {
            Uri origin;
            if (!AccountState.SameEnvironment(environment, environment) ||
                !Uri.TryCreate(PanelState.Text(environment, "endpoint"), UriKind.Absolute, out origin) ||
                !(origin.Scheme == "http" || origin.Scheme == "https") || origin.UserInfo != "") return null;
            var isPlan = id.StartsWith("P-", StringComparison.Ordinal);
            if (isPlan ? String.IsNullOrEmpty(plan) : String.IsNullOrEmpty(harness)) return null;
            var value = (String.IsNullOrEmpty(harness) ? "" : harness + "::") + (isPlan ? plan : id);
            return origin.GetLeftPart(UriPartial.Authority) + "/?" + (isPlan ? "wppop" : "wpop") + "=" + Uri.EscapeDataString(value);
        }
        public static string Markdown(string text, Dictionary<string, object> environment, string harness, string plan)
        {
            var output = new StringBuilder(text ?? "");
            foreach (var match in Parse(text).Reverse())
            {
                var target = Target(match.Value, environment, harness, plan);
                if (target != null) output.Remove(match.Index, match.Length).Insert(match.Index, "[" + match.Value + "](" + target + ")");
            }
            return output.ToString();
        }
    }

    // Markdig owns Markdown parsing. This is only an AST-to-native-WPF
    // projection: selectable documents, no HTML engine or network image loads.
    public static class NativeChatContent
    {
        private static readonly MarkdownPipeline Pipeline = new MarkdownPipelineBuilder().UseAdvancedExtensions().DisableHtml().Build();
        public static RichTextBox View(string text, Action<string> open)
        {
            var document = new FlowDocument { PagePadding = new Thickness(0), FontSize = 14 };
            Blocks(document.Blocks, Markdig.Markdown.Parse(text ?? "", Pipeline), open, text ?? "");
            return new RichTextBox { Document = document, IsReadOnly = true, IsDocumentEnabled = true,
                BorderThickness = new Thickness(0), Background = Brushes.Transparent,
                VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled, Margin = new Thickness(0, 4, 0, 12) };
        }
        private static void Blocks(BlockCollection output, ContainerBlock nodes, Action<string> open, string source)
        {
            foreach (var node in nodes)
            {
                var code = node as CodeBlock;
                if (code != null)
                {
                    output.Add(new Paragraph(new Run(code.Lines.ToString())) { FontFamily = new FontFamily("Consolas"),
                        Background = Brushes.WhiteSmoke, Padding = new Thickness(8) }); continue;
                }
                var list = node as ListBlock;
                if (list != null)
                {
                    int start; if (!Int32.TryParse(list.OrderedStart, out start) || start < 1) start = 1;
                    var native = new System.Windows.Documents.List { MarkerStyle = list.IsOrdered ? TextMarkerStyle.Decimal : TextMarkerStyle.Disc, StartIndex = start };
                    foreach (var child in list.OfType<ListItemBlock>())
                    { var item = new System.Windows.Documents.ListItem(); Blocks(item.Blocks, child, open, source); native.ListItems.Add(item); }
                    output.Add(native); continue;
                }
                var table = node as Markdig.Extensions.Tables.Table;
                if (table != null)
                {
                    var native = new System.Windows.Documents.Table { CellSpacing = 4 }; var group = new TableRowGroup(); native.RowGroups.Add(group);
                    foreach (var row in table.OfType<Markdig.Extensions.Tables.TableRow>())
                    {
                        var line = new System.Windows.Documents.TableRow(); group.Rows.Add(line);
                        foreach (var cell in row.OfType<Markdig.Extensions.Tables.TableCell>())
                        { var value = new System.Windows.Documents.TableCell { BorderBrush = Brushes.LightGray, BorderThickness = new Thickness(1), Padding = new Thickness(4) };
                          Blocks(value.Blocks, cell, open, source); if (row.IsHeader) value.FontWeight = FontWeights.Bold; line.Cells.Add(value); }
                    }
                    output.Add(native); continue;
                }
                var leaf = node as LeafBlock;
                if (leaf != null)
                {
                    var paragraph = new Paragraph { Margin = new Thickness(0, 0, 0, 8) };
                    if (leaf.Inline != null) Inlines(paragraph.Inlines, leaf.Inline, open);
                    else if (node is ThematicBreakBlock) paragraph.Inlines.Add(new Run("────────"));
                    else paragraph.Inlines.Add(new Run(leaf.Lines.ToString()));
                    var heading = leaf as HeadingBlock;
                    if (heading != null) { paragraph.FontWeight = FontWeights.Bold; paragraph.FontSize = 24 - Math.Min(heading.Level, 6) * 2; }
                    output.Add(paragraph); continue;
                }
                var container = node as ContainerBlock;
                if (container != null)
                { var section = new Section(); if (node is QuoteBlock) { section.BorderBrush = Brushes.LightGray; section.BorderThickness = new Thickness(3, 0, 0, 0); section.Padding = new Thickness(10, 0, 0, 0); }
                  Blocks(section.Blocks, container, open, source); output.Add(section); continue; }
                if (node.Span.Start >= 0 && node.Span.End < source.Length)
                    output.Add(new Paragraph(new Run(source.Substring(node.Span.Start, node.Span.End - node.Span.Start + 1))));
            }
        }
        private static void Inlines(InlineCollection output, ContainerInline nodes, Action<string> open)
        {
            foreach (var node in nodes)
            {
                var literal = node as LiteralInline; if (literal != null) { output.Add(new Run(literal.Content.ToString())); continue; }
                var code = node as CodeInline; if (code != null) { output.Add(new Run(code.Content) { FontFamily = new FontFamily("Consolas"), Background = Brushes.WhiteSmoke }); continue; }
                if (node is LineBreakInline) { output.Add(new LineBreak()); continue; }
                var html = node as HtmlInline; if (html != null) { output.Add(new Run(html.Tag)); continue; }
                var task = node as Markdig.Extensions.TaskLists.TaskList;
                if (task != null) { output.Add(new Run(task.Checked ? "☑ " : "☐ ")); continue; }
                var auto = node as AutolinkInline;
                if (auto != null) { var link = Link(auto.Url, open); link.Inlines.Add(new Run(auto.Url)); output.Add(link); continue; }
                var container = node as ContainerInline;
                if (container == null) { output.Add(new Run(node.ToString())); continue; }
                Span span; var target = node as LinkInline;
                if (target != null && !target.IsImage) span = Link(target.Url, open);
                else span = new Span();
                var emphasis = node as EmphasisInline;
                if (emphasis != null)
                { if (emphasis.DelimiterChar == '~') span.TextDecorations = TextDecorations.Strikethrough;
                  else if (emphasis.DelimiterCount >= 2) span.FontWeight = FontWeights.Bold; else span.FontStyle = FontStyles.Italic; }
                Inlines(span.Inlines, container, open); output.Add(span);
            }
        }
        private static Span Link(string value, Action<string> open)
        {
            Uri uri;
            if (!Uri.TryCreate(value, UriKind.Absolute, out uri) || !(uri.Scheme == "https" || uri.Scheme == "http") || uri.UserInfo != "") return new Span();
            var link = new Hyperlink { NavigateUri = uri };
            link.RequestNavigate += (sender, args) => { open(uri.AbsoluteUri); args.Handled = true; };
            return link;
        }
    }
}
