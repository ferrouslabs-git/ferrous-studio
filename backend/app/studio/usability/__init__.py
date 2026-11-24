"""Usability testing: remote, moderated usability studies for a project.

A *study* holds everything about one round of testing: what is tested (its
protocol, consent form, tasks, files and the moderator's script), who takes
part, what the moderator captured for each participant, and the insights
across them. A study can be cloned to reuse or adjust its content.

Studies hang off a project *lineage*, like the board: a round of testing is
live operational state, not part of a design version, so versioning a project
neither copies nor freezes it.
"""
