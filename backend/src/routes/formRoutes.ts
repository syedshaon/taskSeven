import express from "express";
import { protectedRoute } from "../middleware/auth.ts";
import { prisma } from "../lib/prisma.ts";

const router = express.Router();

// Submit a form
router.post("/:templateId", protectedRoute, async (req, res) => {
  try {
    const templateId = parseInt(req.params.templateId);
    const { answers } = req.body;

    // Verify template exists and user has access
    const template = await prisma.template.findUnique({
      where: { id: templateId },
      include: { accesses: true },
    });

    if (!template) {
      return res.status(404).json({ error: "Template not found" });
    }

    if (!template.isPublic && !template.accesses.some((a) => a.userId === req.user!.id) && template.userId !== req.user!.id && !req.user!.isAdmin) {
      return res.status(403).json({ error: "Unauthorized to submit this form" });
    }

    // Verify all required questions are answered
    const questions = await prisma.question.findMany({
      where: { templateId },
    });

    // Create form and answers
    const form = await prisma.form.create({
      data: {
        templateId,
        userId: req.user!.id,
        answers: {
          create: answers.map((answer: any) => ({
            questionId: answer.questionId,
            value: answer.value,
          })),
        },
      },
      include: { answers: true },
    });

    res.status(201).json(form);
  } catch (error) {
    console.error("Error submitting form:", error);
    res.status(500).json({ error: "Failed to submit form" });
  }
});

// Get form results
router.get("/:templateId/results", protectedRoute, async (req, res) => {
  try {
    const templateId = parseInt(req.params.templateId);

    // Verify template ownership
    const template = await prisma.template.findUnique({
      where: { id: templateId },
    });

    if (!template) {
      return res.status(404).json({ error: "Template not found" });
    }

    if (template.userId !== req.user!.id && !req.user!.isAdmin) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // Get all forms for this template
    const forms = await prisma.form.findMany({
      where: { templateId },
      include: {
        user: { select: { name: true } },
        answers: {
          include: { question: true },
        },
      },
    });

    // Get questions for aggregation
    const questions = await prisma.question.findMany({
      where: { templateId },
      orderBy: { position: "asc" },
    });

    // Calculate aggregates
    const aggregates = questions.map((question) => {
      const relevantAnswers = forms.flatMap((form) => form.answers.filter((a) => a.questionId === question.id).map((a) => a.value));

      let analysis: any = { questionId: question.id, type: question.questionType };

      switch (question.questionType) {
        case "INTEGER":
          const nums = relevantAnswers.map(Number).filter((n) => !isNaN(n));
          analysis.average = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
          analysis.min = nums.length ? Math.min(...nums) : null;
          analysis.max = nums.length ? Math.max(...nums) : null;
          break;
        case "CHECKBOX":
          analysis.trueCount = relevantAnswers.filter((a) => a === "true").length;
          analysis.falseCount = relevantAnswers.filter((a) => a === "false").length;
          break;
        case "STRING":
        case "TEXT":
          // Simple frequency analysis for text answers
          const freq: Record<string, number> = {};
          relevantAnswers.forEach((a) => {
            freq[a] = (freq[a] || 0) + 1;
          });
          analysis.frequencies = Object.entries(freq)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
          break;
      }

      return analysis;
    });

    res.json({ forms, aggregates });
  } catch (error) {
    console.error("Error fetching form results:", error);
    res.status(500).json({ error: "Failed to fetch form results" });
  }
});

export default router;
