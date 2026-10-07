import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/lead-course-export")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { parseFilters, json } = await import("@/lib/api.server");
        const { leadCourseDistribution, loadLeadCourseRecords } =
          await import("@/lib/lead-course-distribution.server");
        const { groupDisplayName, stageDisplayName, recordTypeDisplayName } =
          await import("@/lib/lead-distribution-labels");
        const { default: ExcelJS } = await import("exceljs");
        const params = new URL(request.url).searchParams;
        const dimension = params.get("dimension");
        if (dimension !== "course" && dimension !== "specialty")
          return json({ error: "Invalid dimension." }, 400);
        const search = (params.get("search") || "").trim().toLocaleLowerCase();
        if (search.length > 200) return json({ error: "Search is too long." }, 400);
        const ar = params.get("lang") !== "en";

        try {
          const filters = await parseFilters(request);
          const [distribution, records] = await Promise.all([
            leadCourseDistribution(filters),
            loadLeadCourseRecords(filters),
          ]);
          const groups = (
            dimension === "course" ? distribution.byCourse : distribution.bySpecialty
          ).filter((group) =>
            `${group.label} ${groupDisplayName(group.label, dimension, false)}`
              .toLocaleLowerCase()
              .includes(search),
          );
          const visibleLabels = new Set(groups.map((group) => group.label));
          const visibleRecords = records.filter((row) => visibleLabels.has(row[dimension]));
          const workbook = new ExcelJS.Workbook();
          workbook.creator = "Engosoft Insights Hub";
          workbook.created = new Date();

          const safe = (value: string) =>
            ["=", "+", "-", "@"].includes(value.trimStart().charAt(0)) ? `'${value}` : value;
          const summary = workbook.addWorksheet(dimension === "course" ? "Courses" : "Specialties");
          const header = [
            dimension === "course" ? "Course" : "Specialty",
            ar ? "الإجمالي" : "Total",
            ar ? "عملاء محتملون نشطون" : "Active leads",
            ar ? "عملاء محتملون مفقودون" : "Lost leads",
            ar ? "فرص بيعية" : "Opportunities",
            ar ? "عملاء مؤرشفون" : "Archived leads",
            ...distribution.stages.map((stage) => stageDisplayName(stage, ar)),
            ar ? "عالي الأولوية" : "High priority",
            ar ? "تحتاج مراجعة" : "Needs review",
          ];
          summary.addRow(header);
          for (const group of groups) {
            summary.addRow([
              safe(groupDisplayName(group.label, dimension, false)),
              group.count,
              group.leadActive,
              group.leadLost,
              group.opportunities,
              group.leadOther,
              ...distribution.stages.map((stage) => group.opportunityStages[stage] ?? 0),
              group.hot,
              group.unverified,
            ]);
          }

          const detail = workbook.addWorksheet("Leads");
          detail.addRow([
            "Odoo ID",
            ar ? "الاسم" : "Contact",
            "Course",
            "Specialty",
            ar ? "نوع السجل" : "Record type",
            ar ? "المرحلة" : "Stage",
            ar ? "تاريخ الإنشاء" : "Created at",
            ar ? "الأولوية" : "Priority",
            ar ? "الموظف" : "Salesperson",
            ar ? "الفريق" : "Sales team",
            ar ? "المصدر" : "Source",
            ar ? "الشركة" : "Company",
            ar ? "الهاتف" : "Phone",
            ar ? "البريد الإلكتروني" : "Email",
            "Odoo",
          ]);
          for (const row of visibleRecords) {
            const entry = detail.addRow([
              safe(row.id),
              safe(row.contact),
              safe(groupDisplayName(row.course, "course", false)),
              safe(groupDisplayName(row.specialty, "specialty", false)),
              recordTypeDisplayName(row.recordType, ar),
              safe(stageDisplayName(row.stage, ar)),
              row.createdAt,
              safe(row.priority),
              safe(row.salesperson),
              safe(row.salesTeam),
              safe(row.source),
              safe(row.company),
              safe(row.phone),
              safe(row.email),
              "Open in Odoo",
            ]);
            entry.getCell(15).value = { text: "Open in Odoo", hyperlink: row.odooUrl };
            entry.getCell(15).font = { color: { argb: "FF1765CE" }, underline: true };
          }

          for (const sheet of [summary, detail]) {
            sheet.views = [{ state: "frozen", ySplit: 1 }];
            sheet.autoFilter = {
              from: { row: 1, column: 1 },
              to: { row: 1, column: sheet.columnCount },
            };
            sheet.getRow(1).height = 30;
            sheet.getRow(1).eachCell((cell) => {
              cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B2B5B" } };
              cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
              cell.alignment = { vertical: "middle", horizontal: "center" };
            });
            sheet.eachRow((row, rowNumber) => {
              if (rowNumber === 1) return;
              if (rowNumber % 2 === 0)
                row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F7FC" } };
            });
          }
          summary.getColumn(1).width = 28;
          for (let col = 2; col <= summary.columnCount; col++) summary.getColumn(col).width = 19;
          detail.columns.forEach((column, index) => {
            column.width = [16, 30, 22, 28, 18, 21, 22, 18, 26, 24, 24, 24, 22, 32, 19][index];
          });

          const bytes = await workbook.xlsx.writeBuffer();
          const range = `${filters.from || "all"}-to-${filters.to || "all"}`.replace(
            /[^\dA-Za-z-]/g,
            "",
          );
          return new Response(new Uint8Array(bytes), {
            headers: {
              "cache-control": "no-store",
              "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              "content-disposition": `attachment; filename="engosoft-leads-${dimension}-${range}.xlsx"`,
            },
          });
        } catch (error) {
          return json(
            { error: error instanceof Error ? error.message : "Excel export is unavailable." },
            503,
          );
        }
      },
    },
  },
});
